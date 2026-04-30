import { NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { createClient, createServiceClient } from "@/lib/supabase/server"

const MAPS_KEY = process.env.GOOGLE_MAPS_STATIC_KEY || ""
const SIGNED_URL_TTL = 60 * 60

type AnyRow = Record<string, any>

// ---------------- Helpers ----------------

function staticMapUrl(lat: any, lng: any): string | null {
  if (lat == null || lng == null || isNaN(Number(lat)) || isNaN(Number(lng))) return null
  if (!MAPS_KEY) return null
  const c = `${lat},${lng}`
  return `https://maps.googleapis.com/maps/api/staticmap?center=${c}&zoom=17&size=320x200&scale=2&maptype=roadmap&markers=color:0x00d4a0%7C${c}&key=${MAPS_KEY}`
}

async function signOne(service: any, value: string | null | undefined): Promise<string | null> {
  if (!value) return null
  if (value.includes(".r2.dev/") || value.includes(".r2.cloudflarestorage.com/")) return value
  const marker = "/vantro-media/"
  let path: string | null = null
  if (value.startsWith("http")) {
    const idx = value.indexOf(marker)
    if (idx >= 0) path = value.substring(idx + marker.length)
    else return value
  } else path = value
  if (path?.startsWith("/")) path = path.substring(1)
  if (!path) return value
  try {
    const { data, error } = await service.storage.from("vantro-media").createSignedUrl(path, SIGNED_URL_TTL)
    if (error || !data) return value
    return data.signedUrl
  } catch {
    return value
  }
}

async function signMany(service: any, values: any): Promise<string[]> {
  if (!Array.isArray(values)) return []
  const out: string[] = []
  for (const v of values) {
    const s = await signOne(service, v)
    if (s) out.push(s)
  }
  return out
}

function escapeHtml(s: any): string {
  if (s == null) return ""
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/**
 * Render an inline HTML5 video player + "Open full size" link.
 * Used in diary cards and QA cards as evidence playback.
 * Returns empty string if no URL provided.
 */
function renderVideoBlock(videoUrl: string | null | undefined, label: string = "Video evidence"): string {
  if (!videoUrl) return ""
  const safe = escapeHtml(videoUrl)
  return `
    <div class="video-block">
      <video class="video-player" controls preload="metadata" playsinline>
        <source src="${safe}">
        Your browser does not support inline video playback.
      </video>
      <div class="video-caption">
        <span class="video-label">${escapeHtml(label)}</span>
        <a href="${safe}" target="_blank" rel="noopener" class="video-link">Open full size &rarr;</a>
      </div>
    </div>`
}

/**
 * Aggressively hide test/dev diary entries from the audit report.
 * Returns true if entry should be SHOWN, false to hide.
 *
 * Always KEEP if:
 *  - ai_alert_type is "blocker" or "issue" (signal entries)
 *  - has a non-empty reply (someone engaged)
 *
 * Otherwise HIDE if:
 *  - empty text + no photos + no video
 *  - text under 10 chars + no photos + no video
 *  - text matches known test patterns (test, tt, q1-q9, random, etc.)
 */
function isRealDiaryEntry(d: any): boolean {
  // Always keep alert-tagged or replied entries — they have real value
  if (d.ai_alert_type === "blocker" || d.ai_alert_type === "issue") return true
  if (d.reply && String(d.reply).trim().length > 0) return true

  const text = (d.entry_text || "").trim()
  const hasPhotos = Array.isArray(d.photo_urls) && d.photo_urls.length > 0
  const hasVideo = !!d.video_url

  // No content at all -> hide
  if (!text && !hasPhotos && !hasVideo) return false

  // Test pattern matchers (case-insensitive, exact match after trim)
  const testPatterns = [
    /^test\d*$/i,
    /^tt+$/i,
    /^q\d+$/i,
    /^btay$/i,
    /^random$/i,
    /^laptop$/i,
    /^bigg+$/i,
    /^tasd+$/i,
    /^photo entry$/i,
    /^video entry$/i,
    /^test\s+\w{1,5}$/i,        // "test new", "test cars policy" etc.
    /^test\s*\d+$/i,
    /^\d+$/i,                     // pure numbers
    /^[a-z]{1,3}$/i,               // 1-3 letter junk like "gh", "io"
  ]
  if (testPatterns.some((p) => p.test(text))) return false

  // Short text + no media -> almost certainly test
  if (text.length < 10 && !hasPhotos && !hasVideo) return false

  return true
}

/**
 * Group diary entries by calendar day (UK timezone).
 * Returns array of { date, label, entries[] } sorted oldest first.
 */
function groupDiaryByDay(entries: any[]): Array<{ date: string; label: string; entries: any[] }> {
  const groups: Record<string, { date: string; label: string; entries: any[] }> = {}
  for (const d of entries) {
    if (!d.created_at) continue
    const dt = new Date(d.created_at)
    const dateKey = dt.toISOString().slice(0, 10) // YYYY-MM-DD
    const label = dt.toLocaleDateString("en-GB", {
      weekday: "long", day: "2-digit", month: "long", year: "numeric"
    })
    if (!groups[dateKey]) groups[dateKey] = { date: dateKey, label, entries: [] }
    groups[dateKey].entries.push(d)
  }
  return Object.values(groups).sort((a, b) => a.date.localeCompare(b.date))
}

function fmtDateTime(s: string | null | undefined): string {
  if (!s) return "—"
  try {
    return new Date(s).toLocaleString("en-GB", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    })
  } catch { return String(s) }
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—"
  try {
    return new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
  } catch { return String(s) }
}

// ---------------- Templated narrative ----------------

function buildTemplatedNarrative(data: any): string {
  const { signins, qa, diary, defects, period } = data
  const installerSet = new Set<string>()
  let totalHours = 0, autoClosed = 0, departedEarly = 0
  for (const s of signins) {
    if (s.users?.name) installerSet.add(s.users.name)
    if (s.hours_worked) totalHours += Number(s.hours_worked) || 0
    if (s.auto_closed) autoClosed++
    if (s.departed_early) departedEarly++
  }
  const installers = Array.from(installerSet)
  const blockers = diary.filter((d: any) => d.ai_alert_type === "blocker").length
  const issues = diary.filter((d: any) => d.ai_alert_type === "issue").length
  const photoCount = diary.reduce((n: number, d: any) => n + (d.photo_urls?.length || 0), 0)
    + qa.filter((q: any) => q.photo_url).length
    + defects.filter((d: any) => d.photo_url).length
  const qaPass = qa.filter((q: any) => q.state === "approved" || q.value === "pass").length
  const qaFail = qa.filter((q: any) => q.state === "rejected" || q.value === "fail").length
  const qaPending = qa.length - qaPass - qaFail
  const openDefects = defects.filter((d: any) => d.status === "open").length
  const resolvedDefects = defects.filter((d: any) => d.status === "resolved").length
  const critical = defects.filter((d: any) => d.severity === "critical").length

  const periodStr = period.from || period.to
    ? `between ${fmtDate(period.from)} and ${fmtDate(period.to)}`
    : "across the full job period"

  const p1 = installers.length === 0
    ? `No site activity has been recorded ${periodStr}.`
    : `${periodStr.charAt(0).toUpperCase() + periodStr.slice(1)}, ${installers.length === 1 ? installers[0] : `${installers.length} installers (${installers.join(", ")})`} logged ${signins.length} sign-in${signins.length === 1 ? "" : "s"} on this job, totalling ${totalHours.toFixed(1)} hours on site.`

  const flags: string[] = []
  if (autoClosed > 0) flags.push(`${autoClosed} sign-in${autoClosed === 1 ? " was" : "s were"} auto-closed without a proper sign-out`)
  if (departedEarly > 0) flags.push(`${departedEarly} departed early`)
  const p2 = flags.length > 0
    ? `Attendance flags: ${flags.join("; ")}. These should be reviewed against the schedule.`
    : `All sign-ins completed cleanly with proper sign-out.`

  const qaParts: string[] = []
  if (qa.length === 0) qaParts.push("No quality checks were submitted in this period")
  else {
    const bits: string[] = []
    if (qaPass > 0) bits.push(`${qaPass} approved`)
    if (qaFail > 0) bits.push(`${qaFail} rejected`)
    if (qaPending > 0) bits.push(`${qaPending} pending`)
    qaParts.push(`${qa.length} quality check${qa.length === 1 ? "" : "s"} submitted (${bits.join(", ")})`)
  }
  if (diary.length > 0) {
    qaParts.push(`${diary.length} diary entr${diary.length === 1 ? "y" : "ies"} logged`)
    if (blockers > 0 || issues > 0) {
      const ai: string[] = []
      if (blockers > 0) ai.push(`${blockers} blocker${blockers === 1 ? "" : "s"}`)
      if (issues > 0) ai.push(`${issues} issue${issues === 1 ? "" : "s"}`)
      qaParts.push(`AI flagged ${ai.join(" and ")}`)
    }
  }
  if (photoCount > 0) qaParts.push(`${photoCount} photo${photoCount === 1 ? "" : "s"} captured as evidence`)
  const p3 = qaParts.join("; ") + "."

  const defectParts: string[] = []
  if (defects.length === 0) defectParts.push("No defects raised in this period.")
  else {
    if (openDefects > 0) defectParts.push(`${openDefects} defect${openDefects === 1 ? " remains" : "s remain"} open`)
    if (resolvedDefects > 0) defectParts.push(`${resolvedDefects} resolved`)
    if (critical > 0) defectParts.push(`${critical} flagged as critical`)
  }
  const p4 = defectParts.length > 0 ? defectParts.join(", ") + "." : ""

  return [p1, p2, p3, p4].filter(Boolean).join("\n\n")
}

async function buildAINarrative(data: any): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null
  try {
    const client = new Anthropic({ apiKey })
    const summary = {
      job: data.job?.name,
      period: data.period,
      signins_count: data.signins.length,
      total_hours: data.signins.reduce((n: number, s: any) => n + (Number(s.hours_worked) || 0), 0).toFixed(1),
      installers: Array.from(new Set(data.signins.map((s: any) => s.users?.name).filter(Boolean))),
      auto_closed: data.signins.filter((s: any) => s.auto_closed).length,
      departed_early: data.signins.filter((s: any) => s.departed_early).length,
      flag_reasons: data.signins.map((s: any) => s.flag_reason).filter(Boolean),
      qa_count: data.qa.length,
      qa_states: data.qa.map((q: any) => q.state),
      diary_count: data.diary.length,
      blockers: data.diary.filter((d: any) => d.ai_alert_type === "blocker").length,
      issues: data.diary.filter((d: any) => d.ai_alert_type === "issue").length,
      diary_summaries: data.diary.slice(0, 10).map((d: any) => d.entry_text).filter(Boolean).slice(0, 5),
      defects_open: data.defects.filter((d: any) => d.status === "open").length,
      defects_resolved: data.defects.filter((d: any) => d.status === "resolved").length,
      defects_critical: data.defects.filter((d: any) => d.severity === "critical").length,
      defects_descriptions: data.defects.map((d: any) => d.description).filter(Boolean),
    }
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      messages: [{
        role: "user",
        content: `You are writing an executive summary for a UK construction site audit report. Use British English. Be factual, neutral, professional. 3 short paragraphs. No headers, no bullet points, no markdown — flowing prose only. Lead with what happened, follow with attendance and compliance picture, close with outstanding issues. Do not invent details not in the data. Do not editorialise.

Audit data:
${JSON.stringify(summary, null, 2)}

Write the executive summary now.`
      }],
    })
    const block = msg.content.find((b: any) => b.type === "text") as any
    return block?.text || null
  } catch (e: any) {
    console.error("[audit/report] AI narrative error:", e?.message)
    return null
  }
}

// ---------------- Data fetch ----------------

async function fetchAuditData(service: any, companyId: string, jobId: string, from: string | null, to: string | null) {
  const { data: job } = await service
    .from("jobs")
    .select("id, name, address, lat, lng, company_id, required_trades")
    .eq("id", jobId).eq("company_id", companyId).single()
  if (!job) return null

  const { data: company } = await service
    .from("companies")
    .select("id, name, multi_trade_enabled, ai_audit_enabled")
    .eq("id", companyId).single()

  let signinsQ = service.from("signins")
    .select("id, signed_in_at, signed_out_at, lat, lng, sign_out_lat, sign_out_lng, distance_from_site_metres, sign_out_distance_metres, within_range, sign_out_within_range, hours_worked, flagged, flag_reason, departed_early, early_departure_minutes, auto_closed, auto_closed_reason, users!user_id(id, name, trades)")
    .eq("job_id", jobId).order("signed_in_at", { ascending: true })
  if (from) signinsQ = signinsQ.gte("signed_in_at", from)
  if (to) signinsQ = signinsQ.lte("signed_in_at", to + "T23:59:59Z")
  const { data: signinsRaw } = await signinsQ
  const signins = (signinsRaw || []).map((s: AnyRow) => ({
    ...s,
    map_in_url: staticMapUrl(s.lat, s.lng),
    map_out_url: staticMapUrl(s.sign_out_lat, s.sign_out_lng),
  }))

  let qaQ = service.from("qa_submissions")
    .select("id, submitted_at, created_at, state, value, notes, rejection_note, photo_url, video_url, video_ai_summary, checklist_item_id, users!user_id(id, name)")
    .eq("job_id", jobId).order("created_at", { ascending: true })
  if (from) qaQ = qaQ.gte("created_at", from)
  if (to) qaQ = qaQ.lte("created_at", to + "T23:59:59Z")
  const { data: qaRaw } = await qaQ
  const itemIds = Array.from(new Set((qaRaw || []).map((q: AnyRow) => q.checklist_item_id).filter(Boolean)))
  const itemMap: Record<string, AnyRow> = {}
  if (itemIds.length > 0) {
    const { data: items } = await service.from("checklist_items").select("id, label, trade").in("id", itemIds)
    for (const it of items || []) itemMap[it.id] = it
  }
  const qa: AnyRow[] = []
  for (const q of qaRaw || []) {
    qa.push({
      ...q,
      photo_url: await signOne(service, q.photo_url),
      video_url: await signOne(service, q.video_url),
      checklist_items: q.checklist_item_id ? itemMap[q.checklist_item_id] : null,
    })
  }

  let diaryQ = service.from("diary_entries")
    .select("id, created_at, entry_text, ai_alert_type, ai_summary, photo_urls, video_url, video_ai_summary, replied_at, reply, users!user_id(id, name)")
    .eq("job_id", jobId).order("created_at", { ascending: true })
  if (from) diaryQ = diaryQ.gte("created_at", from)
  if (to) diaryQ = diaryQ.lte("created_at", to + "T23:59:59Z")
  const { data: diaryRaw } = await diaryQ
  const diary: AnyRow[] = []
  for (const d of diaryRaw || []) {
    diary.push({
      ...d,
      photo_urls: await signMany(service, d.photo_urls),
      video_url: await signOne(service, d.video_url),
    })
  }

  let defectsQ = service.from("defects")
    .select("id, created_at, status, severity, description, photo_url, resolution_note, resolved_at, users!user_id(id, name)")
    .eq("job_id", jobId).order("created_at", { ascending: true })
  if (from) defectsQ = defectsQ.gte("created_at", from)
  if (to) defectsQ = defectsQ.lte("created_at", to + "T23:59:59Z")
  const { data: defectsRaw } = await defectsQ
  const defects: AnyRow[] = []
  for (const d of defectsRaw || []) {
    defects.push({ ...d, photo_url: await signOne(service, d.photo_url) })
  }

  return { job, company, period: { from, to }, signins, qa, diary, defects }
}

// ---------------- HTML render ----------------

function renderReport(data: any, narrative: string, narrativeIsAI: boolean): string {
  const { job, company, period, signins, qa, diary, defects } = data
  const refId = `VTR-${job.name.replace(/\s+/g, "").toUpperCase().slice(0, 8)}-${Date.now().toString().slice(-8)}`
  const generated = new Date()
  const installerSet = new Set<string>()
  let totalHours = 0
  for (const s of signins) {
    if (s.users?.name) installerSet.add(s.users.name)
    totalHours += Number(s.hours_worked) || 0
  }
  const photoCount = diary.filter(isRealDiaryEntry).reduce((n: number, d: any) => n + (d.photo_urls?.length || 0), 0)
    + qa.filter((q: any) => q.photo_url).length + defects.filter((d: any) => d.photo_url).length
  const qaPass = qa.filter((q: any) => q.state === "approved" || q.value === "pass").length
  const qaFail = qa.filter((q: any) => q.state === "rejected" || q.value === "fail").length
  const compliance = qa.length > 0 ? Math.round((qaPass / qa.length) * 100) : 0
  const openDefects = defects.filter((d: any) => d.status === "open").length
  const blockers = diary.filter((d: any) => d.ai_alert_type === "blocker").length
  const aiFlags = diary.filter((d: any) => d.ai_alert_type).length

  const periodStr = period.from || period.to
    ? `${period.from ? fmtDate(period.from) : "Start"} → ${period.to ? fmtDate(period.to) : "Now"}`
    : "All time"

  // Sections
  const attendanceRows = signins.map((s: any) => {
    const flags: string[] = []
    if (s.auto_closed) flags.push(`<span class="chip chip-warn">Auto-closed</span>`)
    if (s.departed_early) flags.push(`<span class="chip chip-warn">Early ${s.early_departure_minutes ? `(${s.early_departure_minutes}m)` : ""}</span>`)
    if (s.flagged) flags.push(`<span class="chip chip-flag">Flagged</span>`)
    if (s.within_range === false) flags.push(`<span class="chip chip-bad">Out of range in</span>`)
    if (s.sign_out_within_range === false) flags.push(`<span class="chip chip-bad">Out of range out</span>`)
    return `
      <tr>
        <td>${escapeHtml(s.users?.name || "Unknown")}</td>
        <td>${fmtDateTime(s.signed_in_at)}<br><span class="muted">${s.distance_from_site_metres != null ? s.distance_from_site_metres + "m" : ""}</span></td>
        <td>${fmtDateTime(s.signed_out_at)}<br><span class="muted">${s.sign_out_distance_metres != null ? s.sign_out_distance_metres + "m" : ""}</span></td>
        <td class="num">${s.hours_worked ? Number(s.hours_worked).toFixed(1) + "h" : "—"}</td>
        <td>${flags.join(" ") || "—"}</td>
        <td>${s.flag_reason ? `<span class="muted">${escapeHtml(s.flag_reason)}</span>` : ""}</td>
      </tr>`
  }).join("")

  const qaCards = qa.map((q: any) => {
    const stateClass = q.state === "approved" ? "ok" : q.state === "rejected" ? "bad" : "neutral"
    const itemLabel = q.checklist_items?.label || q.template_id || "Quality check"
    return `
      <div class="card">
        <div class="card-head">
          <div>
            <div class="card-title">${escapeHtml(itemLabel)}</div>
            <div class="muted">${escapeHtml(q.users?.name || "Unknown")} · ${fmtDateTime(q.created_at || q.submitted_at)}</div>
          </div>
          <span class="chip chip-${stateClass}">${escapeHtml(q.state || q.value || "submitted")}</span>
        </div>
        ${q.notes ? `<div class="card-body">${escapeHtml(q.notes)}</div>` : ""}
        ${q.rejection_note ? `<div class="card-body bad-note">Rejection: ${escapeHtml(q.rejection_note)}</div>` : ""}
        ${q.photo_url ? `<img class="evidence" src="${escapeHtml(q.photo_url)}" alt="QA photo">` : ""}
        ${renderVideoBlock(q.video_url, "QA video")}
        ${q.video_ai_summary ? `<div class="ai-box"><div class="ai-label">AI video summary</div>${escapeHtml(q.video_ai_summary)}</div>` : ""}
      </div>`
  }).join("") || `<p class="empty">No quality checks recorded in this period.</p>`

  const diaryFiltered = diary.filter(isRealDiaryEntry)
  const diaryGroups = groupDiaryByDay(diaryFiltered)
  const renderDiaryCard = (d: any) => {
    const alertChip = d.ai_alert_type === "blocker" ? `<span class="chip chip-bad">Blocker</span>`
      : d.ai_alert_type === "issue" ? `<span class="chip chip-warn">Issue</span>` : ""
    const photos = (d.photo_urls || []).map((p: string) => `<img class="thumb" src="${escapeHtml(p)}" alt="">`).join("")
    const time = d.created_at
      ? new Date(d.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
      : ""
    return `
      <div class="card ${d.ai_alert_type === "blocker" ? "card-bad" : d.ai_alert_type === "issue" ? "card-warn" : ""}">
        <div class="card-head">
          <div>
            <div class="card-meta"><strong>${escapeHtml(d.users?.name || "Unknown")}</strong> · ${escapeHtml(time)}</div>
          </div>
          ${alertChip}
        </div>
        ${d.entry_text ? `<div class="card-body">${escapeHtml(d.entry_text)}</div>` : ""}
        ${d.ai_summary ? `<div class="ai-box"><div class="ai-label">AI summary</div>${escapeHtml(d.ai_summary)}</div>` : ""}
        ${renderVideoBlock(d.video_url, "Site video")}
        ${d.video_ai_summary ? `<div class="ai-box"><div class="ai-label">AI video summary</div>${escapeHtml(d.video_ai_summary)}</div>` : ""}
        ${photos ? `<div class="thumbs">${photos}</div>` : ""}
        ${d.reply ? `<div class="reply"><strong>Reply:</strong> ${escapeHtml(d.reply)}</div>` : ""}
      </div>`
  }
  const diaryCards = diaryGroups.length === 0
    ? `<p class="empty">No diary entries in this period.</p>`
    : diaryGroups.map((g) => `
        <div class="day-group">
          <div class="day-header">
            <span class="day-label">${escapeHtml(g.label)}</span>
            <span class="day-count">${g.entries.length} entr${g.entries.length === 1 ? "y" : "ies"}</span>
          </div>
          ${g.entries.map(renderDiaryCard).join("")}
        </div>`).join("")
  const diaryShownCount = diaryFiltered.length

  const defectCards = defects.map((d: any) => {
    const sevClass = d.severity === "critical" ? "bad" : d.severity === "major" ? "warn" : "neutral"
    const stClass = d.status === "open" ? "warn" : d.status === "resolved" ? "ok" : "neutral"
    return `
      <div class="card">
        <div class="card-head">
          <div>
            <div class="card-title">${escapeHtml(d.description || "Defect")}</div>
            <div class="muted">${escapeHtml(d.users?.name || "Unknown")} · ${fmtDateTime(d.created_at)}</div>
          </div>
          <div class="chip-row">
            <span class="chip chip-${sevClass}">${escapeHtml(d.severity || "minor")}</span>
            <span class="chip chip-${stClass}">${escapeHtml(d.status || "open")}</span>
          </div>
        </div>
        ${d.photo_url ? `<img class="evidence" src="${escapeHtml(d.photo_url)}" alt="Defect photo">` : ""}
        ${d.resolution_note ? `<div class="card-body"><strong>Resolution:</strong> ${escapeHtml(d.resolution_note)}<br><span class="muted">Resolved ${fmtDateTime(d.resolved_at)}</span></div>` : ""}
      </div>`
  }).join("") || `<p class="empty">No defects raised in this period.</p>`

  const narrativeHtml = narrative.split(/\n\n+/).map((p) => `<p>${escapeHtml(p)}</p>`).join("")

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Vantro Audit — ${escapeHtml(job.name)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root {
    --teal: #00a87a; --teal-dark: #007a59; --ink: #0f172a; --ink-2: #334155;
    --muted: #64748b; --line: #e2e8f0; --bg: #ffffff; --soft: #f8fafc;
    --warn: #f59e0b; --warn-bg: #fef3c7; --bad: #dc2626; --bad-bg: #fee2e2;
    --ok: #16a34a; --ok-bg: #dcfce7;
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 0; background: var(--soft); color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    font-size: 14px; line-height: 1.5; }
  .page { max-width: 900px; margin: 0 auto; background: var(--bg); padding: 56px 64px;
    box-shadow: 0 0 0 1px var(--line); }
  .page + .page { margin-top: 24px; }
  .cover { padding: 80px 64px; }
  h1 { font-size: 32px; margin: 0 0 8px; letter-spacing: -0.02em; color: var(--ink); }
  h2 { font-size: 20px; margin: 40px 0 16px; padding-bottom: 8px; border-bottom: 2px solid var(--teal);
    color: var(--ink); letter-spacing: -0.01em; }
  h3 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted);
    margin: 24px 0 8px; font-weight: 600; }
  p { margin: 0 0 12px; }
  .brand-row { display: flex; align-items: center; gap: 12px; margin-bottom: 48px; }
  .logo { width: 36px; height: 36px; background: var(--teal); border-radius: 8px;
    display: flex; align-items: center; justify-content: center; color: white; font-weight: 700; }
  .brand-name { font-weight: 700; font-size: 18px; }
  .brand-sub { color: var(--muted); font-size: 12px; }
  .ref { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px;
    color: var(--muted); margin-left: auto; }
  .meta { display: grid; grid-template-columns: 140px 1fr; gap: 8px 16px;
    margin: 24px 0 32px; font-size: 14px; }
  .meta dt { color: var(--muted); font-weight: 500; }
  .meta dd { margin: 0; color: var(--ink); }
  .kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;
    margin: 24px 0 32px; }
  .kpi { padding: 16px; background: var(--soft); border: 1px solid var(--line); border-radius: 8px; }
  .kpi-num { font-size: 28px; font-weight: 700; color: var(--ink); letter-spacing: -0.02em; }
  .kpi-num.bad { color: var(--bad); }
  .kpi-num.warn { color: var(--warn); }
  .kpi-num.ok { color: var(--ok); }
  .kpi-label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em;
    margin-top: 4px; }
  .narrative { background: var(--soft); border-left: 3px solid var(--teal); padding: 16px 20px;
    margin: 16px 0 32px; border-radius: 0 8px 8px 0; }
  .narrative p:last-child { margin-bottom: 0; }
  .narrative .source { font-size: 11px; color: var(--muted); margin-top: 12px;
    text-transform: uppercase; letter-spacing: 0.06em; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 16px; font-size: 13px; }
  th { text-align: left; background: var(--soft); padding: 10px 12px; color: var(--muted);
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;
    border-bottom: 1px solid var(--line); }
  td { padding: 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
  .muted { color: var(--muted); font-size: 12px; }
  .chip { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px;
    font-weight: 600; text-transform: capitalize; }
  .chip-ok { background: var(--ok-bg); color: var(--ok); }
  .chip-warn { background: var(--warn-bg); color: var(--warn); }
  .chip-bad { background: var(--bad-bg); color: var(--bad); }
  .chip-flag { background: var(--bad-bg); color: var(--bad); }
  .chip-neutral { background: var(--soft); color: var(--ink-2); border: 1px solid var(--line); }
  .chip-row { display: flex; gap: 6px; flex-wrap: wrap; }
  .card { border: 1px solid var(--line); border-radius: 8px; padding: 16px; margin: 12px 0;
    background: var(--bg); }
  .card-bad { border-left: 3px solid var(--bad); }
  .card-warn { border-left: 3px solid var(--warn); }
  .card-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;
    margin-bottom: 8px; }
  .card-title { font-weight: 600; color: var(--ink); margin-bottom: 2px; }
  .card-body { margin: 8px 0; color: var(--ink-2); }
  .bad-note { color: var(--bad); }
  .evidence { max-width: 100%; max-height: 320px; border-radius: 6px; margin-top: 8px;
    border: 1px solid var(--line); display: block; }
  .thumb { width: 80px; height: 80px; object-fit: cover; border-radius: 4px; border: 1px solid var(--line); }
  .thumbs { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
  .ai-box { background: linear-gradient(135deg, #f0f9ff, #f8fafc); border: 1px solid #dbeafe;
    border-radius: 6px; padding: 10px 12px; margin: 8px 0; font-size: 13px; color: var(--ink-2); }
  .ai-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #2563eb;
    font-weight: 700; margin-bottom: 4px; }
  .reply { margin-top: 8px; padding: 8px 12px; background: var(--soft); border-radius: 6px;
    font-size: 13px; color: var(--ink-2); }
  .empty { color: var(--muted); font-style: italic; padding: 16px 0; }
  .video-block { margin: 8px 0; }
  .video-player { width: 100%; max-width: 600px; max-height: 360px; border-radius: 6px;
    background: #000; border: 1px solid var(--line); display: block; }
  .video-caption { display: flex; justify-content: space-between; align-items: center;
    margin-top: 4px; font-size: 11px; color: var(--muted); max-width: 600px; }
  .video-label { text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
  .video-link { color: var(--teal); text-decoration: none; font-weight: 600; }
  .video-link:hover { text-decoration: underline; }
  @media print {
    .video-block { page-break-inside: avoid; }
    .video-player { display: none; }
    .video-caption::before { content: "[Video available — see digital report] "; color: var(--muted); }
  }
  .day-group { margin: 24px 0; }
  .day-group:first-child { margin-top: 8px; }
  .day-header { display: flex; align-items: baseline; justify-content: space-between;
    margin: 0 0 12px; padding-bottom: 6px; border-bottom: 1px solid var(--line); }
  .day-label { font-weight: 700; color: var(--ink); font-size: 13px;
    text-transform: uppercase; letter-spacing: 0.05em; }
  .day-count { color: var(--muted); font-size: 12px; }
  .card-meta { color: var(--muted); font-size: 12px; }
  .card { padding: 12px 16px; margin: 8px 0; }
  .card-head { margin-bottom: 6px; }
  .kpi-grid { grid-template-columns: repeat(3, 1fr) !important; }
  .footer { margin-top: 64px; padding-top: 16px; border-top: 1px solid var(--line);
    color: var(--muted); font-size: 11px; display: flex; justify-content: space-between; }
  .toolbar { position: sticky; top: 0; background: white; border-bottom: 1px solid var(--line);
    padding: 12px 24px; display: flex; gap: 12px; align-items: center; z-index: 10; }
  .btn { padding: 8px 16px; border-radius: 6px; border: 1px solid var(--line); background: white;
    color: var(--ink); font-weight: 600; font-size: 13px; cursor: pointer; }
  .btn-primary { background: var(--teal); color: white; border-color: var(--teal); }
  .btn-primary:hover { background: var(--teal-dark); }
  @media print {
    body { background: white; }
    .toolbar { display: none; }
    .page { box-shadow: none; padding: 32px 24px; max-width: 100%; }
    .page + .page { margin-top: 0; page-break-before: always; }
    h2 { page-break-after: avoid; }
    .card { page-break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="toolbar">
  <button class="btn btn-primary" onclick="window.print()">Print / Save as PDF</button>
  <span class="muted">Use your browser's print dialog (Cmd/Ctrl+P) to save as PDF</span>
</div>

<!-- PAGE 1: Cover + Executive Summary -->
<section class="page">
  <div class="brand-row">
    <div class="logo">V</div>
    <div>
      <div class="brand-name">Vantro</div>
      <div class="brand-sub">Field Operations · Audit Report</div>
    </div>
    <div class="ref">${refId}</div>
  </div>

  <h1>${escapeHtml(job.name)}</h1>
  <p class="muted">${escapeHtml(job.address || "")}</p>

  <dl class="meta">
    <dt>Period</dt><dd>${escapeHtml(periodStr)}</dd>
    <dt>Generated</dt><dd>${escapeHtml(generated.toLocaleString("en-GB"))}</dd>
    <dt>Produced by</dt><dd>${escapeHtml(company?.name || "Vantro")} · via Vantro</dd>
  </dl>

  <h3>Executive summary</h3>
  <div class="narrative">
    ${narrativeHtml}
    <div class="source">${narrativeIsAI ? "AI-generated summary · Vantro AI Audit Pack" : "Templated summary · Enable AI Audit Pack for AI-generated narrative"}</div>
  </div>

  <h3>Key figures</h3>
  <div class="kpi-grid">
    <div class="kpi"><div class="kpi-num">${signins.length}</div><div class="kpi-label">Sign-ins</div></div>
    <div class="kpi"><div class="kpi-num">${totalHours.toFixed(1)}h</div><div class="kpi-label">Total hours</div></div>
    <div class="kpi"><div class="kpi-num ${qa.length === 0 ? "" : compliance >= 80 ? "ok" : compliance >= 50 ? "warn" : "bad"}">${qa.length === 0 ? "—" : compliance + "%"}</div><div class="kpi-label">QA compliance</div></div>
    <div class="kpi"><div class="kpi-num ${openDefects > 0 ? "bad" : "ok"}">${openDefects}</div><div class="kpi-label">Open defects</div></div>
    <div class="kpi"><div class="kpi-num ${blockers > 0 ? "bad" : ""}">${blockers}</div><div class="kpi-label">Blockers</div></div>
    <div class="kpi"><div class="kpi-num">${diaryShownCount}</div><div class="kpi-label">Diary entries</div></div>
  </div>

  <div class="footer">
    <span>Vantro · getvantro.com · CNNCTD Ltd (NI695071)</span>
    <span>${refId}</span>
  </div>
</section>

<!-- PAGE 2: Attendance -->
<section class="page">
  <h2>Attendance &amp; GPS sign-ins</h2>
  <p class="muted">Every recorded shift with location proof, hours, and any system flags.</p>
  ${signins.length === 0 ? `<p class="empty">No sign-ins recorded in this period.</p>` : `
  <table>
    <thead><tr><th>Installer</th><th>Signed in</th><th>Signed out</th><th class="num">Hours</th><th>Flags</th><th>Notes</th></tr></thead>
    <tbody>${attendanceRows}</tbody>
  </table>`}
  <div class="footer">
    <span>Vantro · getvantro.com</span>
    <span>${refId}</span>
  </div>
</section>

<!-- PAGE 3: Quality compliance -->
<section class="page">
  <h2>Quality compliance</h2>
  <p class="muted">Pass/fail on every checklist item with photo evidence and AI summaries where available.</p>
  ${qaCards}
  <div class="footer">
    <span>Vantro · getvantro.com</span>
    <span>${refId}</span>
  </div>
</section>

<!-- PAGE 4: Site diary -->
<section class="page">
  <h2>Site diary</h2>
  <p class="muted">Daily updates from the team with photos, AI flags, and reply threads.</p>
  ${diaryCards}
  <div class="footer">
    <span>Vantro · getvantro.com</span>
    <span>${refId}</span>
  </div>
</section>

<!-- PAGE 5: Defects -->
<section class="page">
  <h2>Defects</h2>
  <p class="muted">Open and resolved defects with severity, photo evidence, and resolution notes.</p>
  ${defectCards}
  <div class="footer">
    <span>Vantro · getvantro.com · CNNCTD Ltd (NI695071) · Ref ${refId}</span>
    <span>End of report</span>
  </div>
</section>

</body>
</html>`
}

// ---------------- Route ----------------

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const service = await createServiceClient()
  const { data: appUser } = await service.from("users").select("id, company_id").eq("auth_user_id", user.id).single()
  if (!appUser) return NextResponse.json({ error: "User not found" }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const jobId = searchParams.get("jobId")
  const from = searchParams.get("from")
  const to = searchParams.get("to")
  if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 })

  const data = await fetchAuditData(service, appUser.company_id, jobId, from, to)
  if (!data) return NextResponse.json({ error: "Job not found" }, { status: 404 })

  const aiEnabled = !!data.company?.ai_audit_enabled
  let narrative = ""
  let narrativeIsAI = false
  if (aiEnabled) {
    const ai = await buildAINarrative(data)
    if (ai && ai.trim().length > 0) {
      narrative = ai
      narrativeIsAI = true
    }
  }
  if (!narrative) narrative = buildTemplatedNarrative(data)

  const html = renderReport(data, narrative, narrativeIsAI)
  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })
}
