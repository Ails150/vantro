import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"
import { GoogleGenerativeAI } from "@google/generative-ai"

type AnyRow = Record<string, any>

const SIGNED_URL_TTL = 60 * 60 * 24 // 24h

function staticMapUrl(lat: number | null | undefined, lng: number | null | undefined): string | null {
  if (lat == null || lng == null) return null
  const key = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  if (!key) return null
  return `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=16&size=400x200&markers=color:red%7C${lat},${lng}&key=${key}`
}

async function signOne(service: any, value: string | null | undefined): Promise<string | null> {
  if (!value) return null
  let path = value
  if (value.startsWith("http")) {
    const m = value.match(/\/vantro-media\/(.+)$/)
    if (m) path = m[1]
    else return value
  }
  if (path?.startsWith("/")) path = path.substring(1)
  if (!path) return value
  try {
    const { data } = await service.storage.from("vantro-media").createSignedUrl(path, SIGNED_URL_TTL)
    return data?.signedUrl || value
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

interface DeliverableItem {
  id: string
  label: string
  state: string | null
  submittedBy: string | null
  submittedAt: string | null
  photoUrl: string | null
  videoUrl: string | null
  videoAiSummary: string | null
  signedOffBy: string | null
  signedOffAt: string | null
  notes: string | null
}

interface Deliverable {
  id: string
  name: string
  totalItems: number
  completedItems: number
  approvedItems: number
  status: "not_started" | "in_progress" | "completed"
  items: DeliverableItem[]
  aiNarrative?: string | null
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const service = await createServiceClient()
  const { data: appUser } = await service.from("users").select("id, company_id, role").eq("auth_user_id", user.id).single()
  if (!appUser) return NextResponse.json({ error: "User not found" }, { status: 403 })
  const companyId = appUser.company_id

  const body = await request.json()
  const { jobId, from, to } = body
  if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 })

  const { data: job } = await service.from("jobs").select("id, name, address, lat, lng, status, completed_at, completed_by, required_trades").eq("id", jobId).eq("company_id", companyId).single()
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 })

  const { data: company } = await service.from("companies").select("id, name, ai_audit_enabled, ai_audit_trial_ends_at, multi_trade_enabled").eq("id", companyId).single()
  const aiAuditActive = !!company?.ai_audit_enabled

  // Final sign-off (job completion)
  let finalSignoff: any = null
  if (job.status === "completed" && job.completed_at) {
    let completedByName: string | null = null
    if (job.completed_by) {
      const { data: u } = await service.from("users").select("name").eq("id", job.completed_by).single()
      completedByName = u?.name || null
    }
    finalSignoff = { by: completedByName, at: job.completed_at }
  }

  // Pull QA submissions joined with checklist items + templates
  let qaQuery = service.from("qa_submissions").select("id, submitted_at, created_at, state, value, notes, photo_url, video_url, video_ai_summary, checklist_item_id, template_id, reviewed_by, reviewed_at, users!user_id(id, name)").eq("job_id", jobId).order("created_at", { ascending: true })
  if (from) qaQuery = qaQuery.gte("created_at", from)
  if (to) qaQuery = qaQuery.lte("created_at", to + "T23:59:59Z")
  const { data: qaRaw } = await qaQuery

  // Pull all checklist items + templates for grouping
  const itemIds = Array.from(new Set((qaRaw || []).map((q: AnyRow) => q.checklist_item_id).filter(Boolean)))
  const templateIds = Array.from(new Set((qaRaw || []).map((q: AnyRow) => q.template_id).filter(Boolean)))

  const itemMap: Record<string, AnyRow> = {}
  if (itemIds.length > 0) {
    const { data: items } = await service.from("checklist_items").select("id, label, template_id, sort_order").in("id", itemIds)
    for (const it of items || []) itemMap[it.id] = it
  }

  const templateMap: Record<string, AnyRow> = {}
  if (templateIds.length > 0) {
    const { data: templates } = await service.from("checklist_templates").select("id, name").in("id", templateIds)
    for (const t of templates || []) templateMap[t.id] = t
  }

  // Resolve reviewer names for sign-offs
  const reviewerIds = Array.from(new Set((qaRaw || []).map((q: AnyRow) => q.reviewed_by).filter(Boolean)))
  const reviewerMap: Record<string, string> = {}
  if (reviewerIds.length > 0) {
    const { data: rs } = await service.from("users").select("id, name").in("id", reviewerIds)
    for (const r of rs || []) reviewerMap[r.id] = r.name
  }

  // Build deliverables grouped by template
  const deliverablesMap: Record<string, Deliverable> = {}
  for (const tplId of templateIds) {
    deliverablesMap[tplId] = {
      id: tplId,
      name: templateMap[tplId]?.name || "Unnamed checklist",
      totalItems: 0,
      completedItems: 0,
      approvedItems: 0,
      status: "not_started",
      items: []
    }
  }

  for (const q of qaRaw || []) {
    if (!q.template_id || !deliverablesMap[q.template_id]) continue
    const item = q.checklist_item_id ? itemMap[q.checklist_item_id] : null
    const photoSigned = await signOne(service, q.photo_url)
    const videoSigned = await signOne(service, q.video_url)
    const submittedByName = (q.users as any)?.name || null
    deliverablesMap[q.template_id].items.push({
      id: q.id,
      label: item?.label || "(item)",
      state: q.state,
      submittedBy: submittedByName,
      submittedAt: q.submitted_at || q.created_at,
      photoUrl: photoSigned,
      videoUrl: videoSigned,
      videoAiSummary: q.video_ai_summary || null,
      signedOffBy: q.reviewed_by ? reviewerMap[q.reviewed_by] : null,
      signedOffAt: q.reviewed_at || null,
      notes: q.notes || null
    })
  }

  // Compute deliverable stats + status
  for (const dlv of Object.values(deliverablesMap)) {
    dlv.totalItems = dlv.items.length
    dlv.completedItems = dlv.items.filter(i => i.state === "approved" || i.state === "submitted").length
    dlv.approvedItems = dlv.items.filter(i => i.state === "approved").length
    if (dlv.approvedItems === dlv.totalItems && dlv.totalItems > 0) dlv.status = "completed"
    else if (dlv.completedItems > 0) dlv.status = "in_progress"
    else dlv.status = "not_started"
  }

  const deliverables = Object.values(deliverablesMap).sort((a, b) => a.name.localeCompare(b.name))

  // Sign-offs (progressive QA approvals)
  const progressiveSignoffs = (qaRaw || []).filter((q: AnyRow) => q.state === "approved" && q.reviewed_by).map((q: AnyRow) => ({
    type: "qa_approval",
    deliverable: templateMap[q.template_id]?.name || "Unknown",
    item: itemMap[q.checklist_item_id]?.label || "(item)",
    by: reviewerMap[q.reviewed_by] || "Unknown",
    at: q.reviewed_at || q.submitted_at
  })).sort((a: any, b: any) => (b.at || "").localeCompare(a.at || ""))

  // Sign-ins / on-site stats
  let signinsQuery = service.from("signins").select("id, signed_in_at, signed_out_at, lat, lng, sign_out_lat, sign_out_lng, distance_from_site_metres, hours_worked, within_range, users!user_id(id, name)").eq("job_id", jobId).order("signed_in_at", { ascending: true })
  if (from) signinsQuery = signinsQuery.gte("signed_in_at", from)
  if (to) signinsQuery = signinsQuery.lte("signed_in_at", to + "T23:59:59Z")
  const { data: signinsRaw } = await signinsQuery

  const signins = (signinsRaw || []).map((s: AnyRow) => ({ ...s, map_in_url: staticMapUrl(s.lat, s.lng), map_out_url: staticMapUrl(s.sign_out_lat, s.sign_out_lng) }))
  const installerCount = new Set((signinsRaw || []).map((s: AnyRow) => s.users?.id).filter(Boolean)).size
  const totalHours = (signinsRaw || []).reduce((sum: number, s: AnyRow) => sum + (s.hours_worked || 0), 0)
  const inRange = (signinsRaw || []).filter((s: AnyRow) => s.within_range).length
  const total = (signinsRaw || []).length
  const geofenceCompliance = total > 0 ? Math.round((inRange / total) * 100) : 100

  // Issues — diary entries flagged + open defects
  let diaryQuery = service.from("diary_entries").select("id, created_at, entry_text, ai_alert_type, ai_summary, photo_urls, video_url, video_ai_summary, users!user_id(id, name)").eq("job_id", jobId).order("created_at", { ascending: true })
  if (from) diaryQuery = diaryQuery.gte("created_at", from)
  if (to) diaryQuery = diaryQuery.lte("created_at", to + "T23:59:59Z")
  const { data: diaryRaw } = await diaryQuery

  const diary: AnyRow[] = await Promise.all((diaryRaw || []).map(async (d: AnyRow): Promise<AnyRow> => ({ ...d, photo_urls: await signMany(service, d.photo_urls), video_url: await signOne(service, d.video_url) })))
  const blockers = diary.filter(d => d.ai_alert_type === "blocker")
  const issues = diary.filter(d => d.ai_alert_type === "issue")

  let defectsQuery = service.from("defects").select("id, created_at, status, severity, description, photo_url, resolution_note, resolved_at, users!user_id(id, name)").eq("job_id", jobId).order("created_at", { ascending: true })
  if (from) defectsQuery = defectsQuery.gte("created_at", from)
  if (to) defectsQuery = defectsQuery.lte("created_at", to + "T23:59:59Z")
  const { data: defectsRaw } = await defectsQuery
  const defects: AnyRow[] = await Promise.all((defectsRaw || []).map(async (d: AnyRow): Promise<AnyRow> => ({ ...d, photo_url: await signOne(service, d.photo_url) })))
  const openDefects = defects.filter(d => d.status !== "resolved")

  // ===== AI PATH (Path B) =====
  let execSummary: string | null = null
  let redFlags: any[] = []

  if (aiAuditActive && process.env.GEMINI_API_KEY) {
    try {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" })

      // Build context
      const context = {
        job: { name: job.name, address: job.address, status: job.status },
        period: { from, to },
        onSite: { installerCount, totalHours: Math.round(totalHours * 10) / 10, geofenceCompliance },
        deliverables: deliverables.map(d => ({ name: d.name, status: d.status, progress: `${d.approvedItems}/${d.totalItems} approved` })),
        signoffs: progressiveSignoffs.length,
        finalSignoff: finalSignoff ? `Job marked complete by ${finalSignoff.by}` : null,
        blockers: blockers.map(b => ({ summary: b.ai_summary, text: b.entry_text?.slice(0, 200) })),
        issues: issues.map(i => ({ summary: i.ai_summary, text: i.entry_text?.slice(0, 200) })),
        openDefects: openDefects.map(d => ({ severity: d.severity, description: d.description?.slice(0, 200) }))
      }

      // Exec summary prompt
      const execPrompt = `You are summarising a construction job audit report for a UK trades business owner. Be direct, factual, no fluff.

Data:
${JSON.stringify(context, null, 2)}

Return ONLY a JSON object with this exact shape:
{
  "summary": "4-5 sentence executive briefing covering: what was delivered this period, who signed it off, any blockers or risks, what's next. UK English.",
  "redFlags": [
    { "severity": "high" | "medium" | "low", "item": "short title", "action": "one-line recommended action" }
  ]
}

Only flag things that are genuinely actionable. If nothing's wrong, return redFlags: []. No prose outside the JSON.`

      const execResult = await model.generateContent(execPrompt)
      const execText = execResult.response.text()
      const cleanJson = execText.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim()
      const parsed = JSON.parse(cleanJson)
      execSummary = parsed.summary || null
      redFlags = parsed.redFlags || []

      // Per-deliverable narratives (parallel)
      const narrativeResults = await Promise.all(deliverables.map(async (dlv) => {
        if (dlv.totalItems === 0) return { id: dlv.id, narrative: null }
        const dlvPrompt = `Write ONE sentence describing the status of this deliverable for a construction audit report. UK English, factual, no fluff.

Deliverable: ${dlv.name}
Items: ${dlv.totalItems} total, ${dlv.approvedItems} approved
Status: ${dlv.status}
Sample items: ${dlv.items.slice(0, 5).map(i => `${i.label} (${i.state})`).join("; ")}
Video summaries: ${dlv.items.map(i => i.videoAiSummary).filter(Boolean).slice(0, 3).join(" | ") || "none"}

Return only the sentence, no JSON, no quotes, no preamble.`
        try {
          const r = await model.generateContent(dlvPrompt)
          return { id: dlv.id, narrative: r.response.text().trim() }
        } catch {
          return { id: dlv.id, narrative: null }
        }
      }))

      for (const nr of narrativeResults) {
        const dlv = deliverables.find(d => d.id === nr.id)
        if (dlv) dlv.aiNarrative = nr.narrative
      }
    } catch (err: any) {
      console.error("[audit/v2] AI generation failed:", err?.message)
    }
  }

  return NextResponse.json({
    job,
    period: { from, to },
    status: job.status,
    finalSignoff,
    deliverables,
    signoffs: progressiveSignoffs,
    onSite: { installerCount, totalHours: Math.round(totalHours * 10) / 10, geofenceCompliance, fullLog: signins },
    issues: { blockers, issues, openDefects, allDefects: defects },
    fullEvidence: { qa: qaRaw || [], diary, signins },
    aiAuditActive,
    execSummary,
    redFlags,
    generated: new Date().toISOString()
  })
}
