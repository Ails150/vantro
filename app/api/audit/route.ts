import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

const MAPS_KEY = process.env.GOOGLE_MAPS_STATIC_KEY || ""
const SIGNED_URL_TTL = 60 * 60 // 1 hour

type AnyRow = Record<string, any>

// ---------- Helpers ----------

function staticMapUrl(lat: number | null | undefined, lng: number | null | undefined): string | null {
  if (lat == null || lng == null || isNaN(Number(lat)) || isNaN(Number(lng))) return null
  if (!MAPS_KEY) return null
  const c = `${lat},${lng}`
  return (
    `https://maps.googleapis.com/maps/api/staticmap` +
    `?center=${c}&zoom=17&size=480x300&scale=2&maptype=roadmap` +
    `&markers=color:0x00d4a0%7C${c}&key=${MAPS_KEY}`
  )
}

/**
 * Convert a stored value into a usable URL for the audit pack.
 *  - Cloudflare R2 URLs (pub-*.r2.dev) -> passed through unchanged (already public)
 *  - Full Supabase public URLs containing "/vantro-media/" -> path extracted, signed
 *  - Bare paths -> signed
 *  - Anything else -> returned unchanged
 * Returns null only when input is null/empty.
 */
async function signOne(service: any, value: string | null | undefined): Promise<string | null> {
  if (!value) return null

  // R2 (Cloudflare) URLs are already public, no signing needed
  if (value.includes(".r2.dev/") || value.includes(".r2.cloudflarestorage.com/")) {
    return value
  }

  // Only sign if it looks like a Supabase path or vantro-media URL
  const marker = "/vantro-media/"
  let path: string | null = null
  if (value.startsWith("http")) {
    const idx = value.indexOf(marker)
    if (idx >= 0) {
      path = value.substring(idx + marker.length)
    } else {
      // Unknown remote URL — return as-is
      return value
    }
  } else {
    // Treat as bare storage path
    path = value
  }

  if (path?.startsWith("/")) path = path.substring(1)
  if (!path) return value

  try {
    const { data, error } = await service.storage
      .from("vantro-media")
      .createSignedUrl(path, SIGNED_URL_TTL)
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

// ---------- Route ----------

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const service = await createServiceClient()

  const { data: appUser, error: userErr } = await service
    .from("users")
    .select("id, company_id, role")
    .eq("auth_user_id", user.id)
    .single()
  if (userErr || !appUser) {
    return NextResponse.json({ error: "User not found" }, { status: 403 })
  }
  const companyId = appUser.company_id

  const { searchParams } = new URL(request.url)
  const jobId = searchParams.get("jobId")
  const from = searchParams.get("from")
  const to = searchParams.get("to")
  if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 })

  const { data: job, error: jobErr } = await service
    .from("jobs")
    .select("id, name, address, lat, lng, company_id, required_trades")
    .eq("id", jobId)
    .eq("company_id", companyId)
    .single()
  if (jobErr || !job) return NextResponse.json({ error: "Job not found" }, { status: 404 })

  const { data: company } = await service
    .from("companies")
    .select("id, name, multi_trade_enabled, ai_audit_enabled, ai_audit_trial_ends_at")
    .eq("id", companyId)
    .single()

  const multi_trade_enabled = !!company?.multi_trade_enabled
  const ai_audit_enabled = !!company?.ai_audit_enabled

  let companyTrades: AnyRow[] = []
  if (multi_trade_enabled) {
    const { data: trades, error: tradesErr } = await service
      .from("company_trades")
      .select("id, name, slug")
      .eq("company_id", companyId)
      .order("name", { ascending: true })
    if (tradesErr) console.error("[audit] companyTrades error:", tradesErr.message)
    companyTrades = trades || []
  }

  // Sign-ins — single users FK (user_id), no ambiguity
  let signinsQuery = service
    .from("signins")
    .select(
      "id, signed_in_at, signed_out_at, lat, lng, sign_out_lat, sign_out_lng, distance_from_site_metres, sign_out_distance_metres, within_range, sign_out_within_range, hours_worked, flagged, flag_reason, departed_early, early_departure_minutes, auto_closed, auto_closed_reason, users!user_id(id, name, trades)"
    )
    .eq("job_id", jobId)
    .order("signed_in_at", { ascending: true })
  if (from) signinsQuery = signinsQuery.gte("signed_in_at", from)
  if (to) signinsQuery = signinsQuery.lte("signed_in_at", to + "T23:59:59Z")
  const { data: signinsRaw, error: signinsErr } = await signinsQuery
  if (signinsErr) console.error("[audit] signins error:", signinsErr.message)

  const signins = (signinsRaw || []).map((s: AnyRow) => ({
    ...s,
    distance_metres: s.distance_from_site_metres,
    map_in_url: staticMapUrl(s.lat, s.lng),
    map_out_url: staticMapUrl(s.sign_out_lat, s.sign_out_lng),
  }))

  // QA submissions — explicit user_id FK hint (table also has reviewed_by FK)
  // checklist_items join dropped: we expose checklist_item_id and let frontend resolve
  let qaQuery = service
    .from("qa_submissions")
    .select(
      "id, submitted_at, created_at, state, value, notes, rejection_note, photo_url, video_url, video_ai_summary, video_ai_summary_at, checklist_item_id, template_id, users!user_id(id, name)"
    )
    .eq("job_id", jobId)
    .order("created_at", { ascending: true })
  if (from) qaQuery = qaQuery.gte("created_at", from)
  if (to) qaQuery = qaQuery.lte("created_at", to + "T23:59:59Z")
  const { data: qaRaw, error: qaErr } = await qaQuery
  if (qaErr) console.error("[audit] qa error:", qaErr.message)

  // Resolve checklist item labels in one batch (avoids broken join)
  const itemIds = Array.from(new Set((qaRaw || []).map((q: AnyRow) => q.checklist_item_id).filter(Boolean)))
  const itemMap: Record<string, AnyRow> = {}
  if (itemIds.length > 0) {
    const { data: items, error: itemsErr } = await service
      .from("checklist_items")
      .select("id, label, trade")
      .in("id", itemIds)
    if (itemsErr) console.error("[audit] checklist_items error:", itemsErr.message)
    for (const it of items || []) itemMap[it.id] = it
  }

  const qa: AnyRow[] = []
  for (const q of qaRaw || []) {
    const item = q.checklist_item_id ? itemMap[q.checklist_item_id] : null
    qa.push({
      ...q,
      result: q.state,
      note: q.notes,
      photo_url: await signOne(service, q.photo_url),
      photo_urls: q.photo_url ? [await signOne(service, q.photo_url)].filter(Boolean) : [],
      video_url: await signOne(service, q.video_url),
      checklist_items: item || null,
    })
  }

  // Diary — explicit user_id FK hint (table also has replied_by FK)
  let diaryQuery = service
    .from("diary_entries")
    .select(
      "id, created_at, entry_text, ai_alert_type, ai_summary, photo_urls, video_url, video_ai_summary, video_ai_summary_at, replied_at, reply, users!user_id(id, name)"
    )
    .eq("job_id", jobId)
    .order("created_at", { ascending: true })
  if (from) diaryQuery = diaryQuery.gte("created_at", from)
  if (to) diaryQuery = diaryQuery.lte("created_at", to + "T23:59:59Z")
  const { data: diaryRaw, error: diaryErr } = await diaryQuery
  if (diaryErr) console.error("[audit] diary error:", diaryErr.message)

  const diary: AnyRow[] = []
  for (const d of diaryRaw || []) {
    diary.push({
      ...d,
      note: d.entry_text,
      severity: d.ai_alert_type,
      photo_urls: await signMany(service, d.photo_urls),
      video_url: await signOne(service, d.video_url),
    })
  }

  // Defects — single user_id FK, plus resolved_by which is also a users FK
  // To be safe, hint anyway
  let defectsQuery = service
    .from("defects")
    .select(
      "id, created_at, status, severity, description, photo_url, resolution_note, resolved_at, resolved_by, user_id, users!user_id(id, name)"
    )
    .eq("job_id", jobId)
    .order("created_at", { ascending: true })
  if (from) defectsQuery = defectsQuery.gte("created_at", from)
  if (to) defectsQuery = defectsQuery.lte("created_at", to + "T23:59:59Z")
  const { data: defectsRaw, error: defectsErr } = await defectsQuery
  if (defectsErr) console.error("[audit] defects error:", defectsErr.message)

  const defects: AnyRow[] = []
  for (const d of defectsRaw || []) {
    defects.push({
      ...d,
      note: d.description,
      photo_url: await signOne(service, d.photo_url),
      photo_urls: d.photo_url ? [await signOne(service, d.photo_url)].filter(Boolean) : [],
    })
  }

  return NextResponse.json({
    job,
    period: { from, to },
    multi_trade_enabled,
    companyTrades,
    ai_audit_enabled,
    signins,
    qa,
    diary,
    defects,
    generated: new Date().toISOString(),
  })
}
