import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

// Completed Quality Checklist sign-off sheet — the Fieldwire replacement.
// Renders a printable HTML page (browser "Save as PDF") showing every checklist
// item with installer initials/date, RFL initials/date, result, hold-point flags,
// remedial actions and photo evidence. Admin/foreman/superadmin only.
//
//   GET /api/qa/checklist-pdf?jobId=...&userId=...   (userId optional)

function escapeHtml(s: any): string {
  if (s == null) return ""
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—"
  try {
    return new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
  } catch { return String(s) }
}

function resultChip(state: string | null | undefined): string {
  const s = (state || "").toLowerCase()
  if (s === "pass" || s === "submitted") return `<span class="chip chip-ok">Pass</span>`
  if (s === "fail") return `<span class="chip chip-bad">Fail</span>`
  if (s === "na" || s === "n/a") return `<span class="chip chip-neutral">N/A</span>`
  return `<span class="chip chip-neutral">${escapeHtml(state || "—")}</span>`
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const service = await createServiceClient()
  const { data: u } = await service.from("users").select("id, company_id, role").eq("auth_user_id", user.id).single()
  if (!u || !["admin", "foreman", "superadmin"].includes(u.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const jobId = searchParams.get("jobId")
  const userId = searchParams.get("userId")
  if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 })

  const { data: job } = await service.from("jobs")
    .select("id, name, address, contractor, company_id")
    .eq("id", jobId).eq("company_id", u.company_id).maybeSingle()
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 })

  const { data: company } = await service.from("companies").select("name").eq("id", u.company_id).maybeSingle()

  // Submissions for this job (optionally one installer). Fall back if hold_point
  // isn't migrated yet so the sheet still renders.
  let q = service.from("qa_submissions")
    .select("*, checklist_items(label, item_type, hold_point), users(name, initials)")
    .eq("job_id", jobId).eq("company_id", u.company_id)
  if (userId) q = q.eq("user_id", userId)
  let { data: submissions, error: subErr } = await q
  if (subErr) {
    let q2 = service.from("qa_submissions")
      .select("*, checklist_items(label, item_type), users(name, initials)")
      .eq("job_id", jobId).eq("company_id", u.company_id)
    if (userId) q2 = q2.eq("user_id", userId)
    ;({ data: submissions } = await q2)
  }
  submissions = submissions || []

  // Template names for grouping.
  const templateIds = Array.from(new Set(submissions.map((s: any) => s.template_id).filter(Boolean)))
  const templateNames: Record<string, string> = {}
  if (templateIds.length) {
    const { data: tpls } = await service.from("checklist_templates").select("id, name").in("id", templateIds)
    for (const t of tpls || []) templateNames[t.id] = t.name
  }

  // Sign photo URLs so they render inside the sheet.
  for (const s of submissions) {
    if (s.photo_path) {
      const { data } = await service.storage.from("vantro-media").createSignedUrl(s.photo_path, 3600)
      if (data) s.signed_photo = data.signedUrl
    }
  }

  // Group by template, preserving item order within each group.
  const groups: Record<string, any[]> = {}
  for (const s of submissions) {
    const key = s.template_id || "_none"
    ;(groups[key] = groups[key] || []).push(s)
  }
  for (const key of Object.keys(groups)) {
    groups[key].sort((a: any, b: any) =>
      String(a.created_at || a.submitted_at || "").localeCompare(String(b.created_at || b.submitted_at || "")))
  }

  const installerSet = new Set<string>()
  for (const s of submissions) if (s.users?.name) installerSet.add(s.users.name)
  const installers = Array.from(installerSet)

  const total = submissions.length
  const passed = submissions.filter((s: any) => ["pass", "submitted"].includes((s.state || "").toLowerCase())).length
  const failed = submissions.filter((s: any) => (s.state || "").toLowerCase() === "fail").length
  const holdPoints = submissions.filter((s: any) => s.checklist_items?.hold_point).length
  const holdSigned = submissions.filter((s: any) => s.checklist_items?.hold_point && s.rfl_initials && String(s.rfl_initials).trim()).length

  const refId = `VTR-QA-${String(job.name).replace(/\s+/g, "").toUpperCase().slice(0, 8)}-${jobId.slice(0, 6).toUpperCase()}`
  const generated = new Date()

  const renderRow = (s: any, idx: number) => {
    const hold = s.checklist_items?.hold_point
    const installer = s.installer_initials
      ? `${escapeHtml(s.installer_initials)}${s.installer_date ? `<br><span class="muted">${escapeHtml(fmtDate(s.installer_date))}</span>` : ""}`
      : "—"
    const rfl = s.rfl_initials
      ? `${escapeHtml(s.rfl_initials)}${s.rfl_date ? `<br><span class="muted">${escapeHtml(fmtDate(s.rfl_date))}</span>` : ""}`
      : (hold ? `<span class="chip chip-warn">Awaiting RFL</span>` : "—")
    const notes: string[] = []
    if (s.notes) notes.push(escapeHtml(s.notes))
    if (s.remedial_action) notes.push(`<span class="remedial">Remedial: ${escapeHtml(s.remedial_action)}</span>`)
    const photo = s.signed_photo || s.photo_url
    return `
      <tr>
        <td class="num">${idx + 1}</td>
        <td>
          <div class="item-label">${escapeHtml(s.checklist_items?.label || "Item")}${hold ? ` <span class="chip chip-warn">⛔ Hold point</span>` : ""}</div>
          ${s.checklist_items?.item_type ? `<div class="muted cap">${escapeHtml(String(s.checklist_items.item_type).replace(/_/g, " "))}</div>` : ""}
        </td>
        <td>${resultChip(s.state)}</td>
        <td class="sign">${installer}</td>
        <td class="sign">${rfl}</td>
        <td>${notes.join("<br>") || ""}</td>
        <td>${photo ? `<a href="${escapeHtml(photo)}" target="_blank" rel="noopener"><img class="thumb" src="${escapeHtml(photo)}" alt="evidence"></a>` : ""}</td>
      </tr>`
  }

  const sections = Object.keys(groups).map((key) => {
    const name = key === "_none" ? "Checklist items" : (templateNames[key] || "Checklist")
    const rows = groups[key].map(renderRow).join("")
    return `
      <h2>${escapeHtml(name)}</h2>
      <table>
        <thead><tr>
          <th class="num">#</th><th>Item</th><th>Result</th><th>Installer</th><th>RFL sign-off</th><th>Notes / remedial</th><th>Evidence</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`
  }).join("")

  const body = total === 0
    ? `<p class="empty">No checklist submissions recorded for this job${userId ? " by this installer" : ""} yet.</p>`
    : sections

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Completed Quality Checklist — ${escapeHtml(job.name)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root { --teal:#00a87a; --teal-dark:#007a59; --ink:#0f172a; --ink-2:#334155;
    --muted:#64748b; --line:#e2e8f0; --bg:#fff; --soft:#f8fafc;
    --warn:#f59e0b; --warn-bg:#fef3c7; --bad:#dc2626; --bad-bg:#fee2e2; --ok:#16a34a; --ok-bg:#dcfce7; }
  * { box-sizing: border-box; }
  body { margin:0; padding:0; background:var(--soft); color:var(--ink);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Helvetica Neue",Arial,sans-serif; font-size:14px; line-height:1.5; }
  .page { max-width:980px; margin:0 auto; background:var(--bg); padding:48px 56px; box-shadow:0 0 0 1px var(--line); }
  h1 { font-size:28px; margin:0 0 4px; letter-spacing:-0.02em; }
  h2 { font-size:18px; margin:32px 0 12px; padding-bottom:8px; border-bottom:2px solid var(--teal); }
  .brand-row { display:flex; align-items:center; gap:12px; margin-bottom:32px; }
  .logo { width:36px; height:36px; background:var(--teal); border-radius:8px; display:flex; align-items:center; justify-content:center; color:#fff; font-weight:700; }
  .brand-name { font-weight:700; font-size:18px; }
  .brand-sub { color:var(--muted); font-size:12px; }
  .ref { font-family:ui-monospace,"SF Mono",Menlo,monospace; font-size:12px; color:var(--muted); margin-left:auto; }
  .meta { display:grid; grid-template-columns:140px 1fr; gap:6px 16px; margin:16px 0 24px; font-size:14px; }
  .meta dt { color:var(--muted); font-weight:500; }
  .meta dd { margin:0; }
  .kpi-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin:16px 0 8px; }
  .kpi { padding:14px; background:var(--soft); border:1px solid var(--line); border-radius:8px; }
  .kpi-num { font-size:24px; font-weight:700; letter-spacing:-0.02em; }
  .kpi-num.bad { color:var(--bad); } .kpi-num.warn { color:var(--warn); } .kpi-num.ok { color:var(--ok); }
  .kpi-label { font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:0.05em; margin-top:4px; }
  table { width:100%; border-collapse:collapse; margin:8px 0 8px; font-size:13px; }
  th { text-align:left; background:var(--soft); padding:9px 10px; color:var(--muted); font-size:11px;
    text-transform:uppercase; letter-spacing:0.05em; font-weight:600; border-bottom:1px solid var(--line); }
  td { padding:10px; border-bottom:1px solid var(--line); vertical-align:top; }
  td.num, th.num { text-align:right; width:32px; color:var(--muted); }
  td.sign { font-weight:600; white-space:nowrap; }
  .item-label { font-weight:600; color:var(--ink); }
  .muted { color:var(--muted); font-size:12px; }
  .cap { text-transform:capitalize; }
  .remedial { color:var(--warn); font-weight:600; }
  .chip { display:inline-block; padding:2px 8px; border-radius:999px; font-size:11px; font-weight:600; }
  .chip-ok { background:var(--ok-bg); color:var(--ok); }
  .chip-warn { background:var(--warn-bg); color:var(--warn); }
  .chip-bad { background:var(--bad-bg); color:var(--bad); }
  .chip-neutral { background:var(--soft); color:var(--ink-2); border:1px solid var(--line); }
  .thumb { width:64px; height:64px; object-fit:cover; border-radius:4px; border:1px solid var(--line); }
  .empty { color:var(--muted); font-style:italic; padding:24px 0; }
  .signoff-box { margin-top:40px; display:grid; grid-template-columns:1fr 1fr; gap:24px; }
  .signoff-box .sig { border-top:1px solid var(--ink); padding-top:6px; font-size:12px; color:var(--muted); }
  .footer { margin-top:48px; padding-top:16px; border-top:1px solid var(--line); color:var(--muted); font-size:11px; display:flex; justify-content:space-between; }
  .toolbar { position:sticky; top:0; background:#fff; border-bottom:1px solid var(--line); padding:12px 24px; display:flex; gap:12px; align-items:center; z-index:10; }
  .btn { padding:8px 16px; border-radius:6px; border:1px solid var(--line); background:#fff; color:var(--ink); font-weight:600; font-size:13px; cursor:pointer; }
  .btn-primary { background:var(--teal); color:#fff; border-color:var(--teal); }
  .btn-primary:hover { background:var(--teal-dark); }
  @media print {
    body { background:#fff; } .toolbar { display:none; }
    .page { box-shadow:none; padding:24px; max-width:100%; }
    h2 { page-break-after:avoid; } tr { page-break-inside:avoid; }
  }
</style>
</head>
<body>
<div class="toolbar">
  <button class="btn btn-primary" onclick="window.print()">Print / Save as PDF</button>
  <span class="muted">Use your browser's print dialog (Cmd/Ctrl+P) to save as PDF</span>
</div>
<section class="page">
  <div class="brand-row">
    <div class="logo">V</div>
    <div>
      <div class="brand-name">Vantro</div>
      <div class="brand-sub">Completed Quality Checklist · Sign-off Sheet</div>
    </div>
    <div class="ref">${escapeHtml(refId)}</div>
  </div>

  <h1>${escapeHtml(job.name)}</h1>
  <p class="muted">${escapeHtml(job.address || "")}</p>

  <dl class="meta">
    ${job.contractor ? `<dt>Contractor</dt><dd>${escapeHtml(job.contractor)}</dd>` : ""}
    <dt>Installer${installers.length === 1 ? "" : "s"}</dt><dd>${installers.length ? escapeHtml(installers.join(", ")) : "—"}</dd>
    <dt>Generated</dt><dd>${escapeHtml(generated.toLocaleString("en-GB"))}</dd>
    <dt>Produced by</dt><dd>${escapeHtml(company?.name || "Vantro")} · via Vantro</dd>
  </dl>

  <div class="kpi-grid">
    <div class="kpi"><div class="kpi-num">${total}</div><div class="kpi-label">Items</div></div>
    <div class="kpi"><div class="kpi-num ok">${passed}</div><div class="kpi-label">Passed</div></div>
    <div class="kpi"><div class="kpi-num ${failed > 0 ? "bad" : ""}">${failed}</div><div class="kpi-label">Failed</div></div>
    <div class="kpi"><div class="kpi-num ${holdPoints > 0 && holdSigned < holdPoints ? "warn" : ""}">${holdSigned}/${holdPoints}</div><div class="kpi-label">Hold points signed</div></div>
  </div>

  ${body}

  <div class="signoff-box">
    <div class="sig">Installer signature &amp; date</div>
    <div class="sig">RFL / Supervisor signature &amp; date</div>
  </div>

  <div class="footer">
    <span>Vantro · getvantro.com · CNNCTD Ltd (NI695071)</span>
    <span>${escapeHtml(refId)}</span>
  </div>
</section>
</body>
</html>`

  return new NextResponse(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } })
}
