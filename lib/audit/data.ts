/**
 * Audit data layer — single source of truth for fetching audit-pack data
 * from Supabase, with URL signing for evidence media (Cloudflare R2 stays
 * unsigned, Supabase storage paths get a 1-hour signed URL).
 *
 * Used by:
 *   - app/api/audit/report/route.ts (HTML report endpoint)
 *
 * Future:
 *   - app/api/audit/route.ts (when AuditTab is refactored to consume same shape)
 *   - any further audit-related endpoints
 */

const MAPS_KEY = process.env.GOOGLE_MAPS_STATIC_KEY || ""
const SIGNED_URL_TTL = 60 * 60 // 1 hour

type AnyRow = Record<string, any>

// ---------------- Helpers ----------------

export function staticMapUrl(lat: any, lng: any): string | null {
  if (lat == null || lng == null || isNaN(Number(lat)) || isNaN(Number(lng))) return null
  if (!MAPS_KEY) return null
  const c = `${lat},${lng}`
  return `https://maps.googleapis.com/maps/api/staticmap?center=${c}&zoom=17&size=320x200&scale=2&maptype=roadmap&markers=color:0x00d4a0%7C${c}&key=${MAPS_KEY}`
}

/**
 * Convert a stored value into a usable URL.
 *  - Cloudflare R2 URLs (pub-*.r2.dev) -> passed through unchanged (already public)
 *  - Full Supabase public URLs containing "/vantro-media/" -> path extracted, signed
 *  - Bare paths -> signed
 *  - Anything else -> returned unchanged
 */
export async function signOne(service: any, value: string | null | undefined): Promise<string | null> {
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

export async function signMany(service: any, values: any): Promise<string[]> {
  if (!Array.isArray(values)) return []
  const out: string[] = []
  for (const v of values) {
    const s = await signOne(service, v)
    if (s) out.push(s)
  }
  return out
}

// ---------------- Data fetch ----------------

export interface AuditData {
  job: AnyRow
  company: AnyRow | null
  period: { from: string | null; to: string | null }
  signins: AnyRow[]
  qa: AnyRow[]
  diary: AnyRow[]
  defects: AnyRow[]
}

/**
 * Pulls the full audit dataset for a job from Supabase.
 * Returns null if the job doesn't exist for the given company.
 *
 * This is the single source of truth — every audit-related route should
 * call this rather than repeating the queries.
 */
export async function fetchAuditData(
  service: any,
  companyId: string,
  jobId: string,
  from: string | null,
  to: string | null
): Promise<AuditData | null> {
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
  const { data: signinsRaw, error: signinsErr } = await signinsQ
  if (signinsErr) console.error("[audit] signins error:", signinsErr.message)
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
  const { data: qaRaw, error: qaErr } = await qaQ
  if (qaErr) console.error("[audit] qa error:", qaErr.message)

  // Resolve checklist item labels in one batch
  const itemIds = Array.from(new Set((qaRaw || []).map((q: AnyRow) => q.checklist_item_id).filter(Boolean)))
  const itemMap: Record<string, AnyRow> = {}
  if (itemIds.length > 0) {
    const { data: items, error: itemsErr } = await service.from("checklist_items").select("id, label, trade").in("id", itemIds)
    if (itemsErr) console.error("[audit] checklist_items error:", itemsErr.message)
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
  const { data: diaryRaw, error: diaryErr } = await diaryQ
  if (diaryErr) console.error("[audit] diary error:", diaryErr.message)
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
  const { data: defectsRaw, error: defectsErr } = await defectsQ
  if (defectsErr) console.error("[audit] defects error:", defectsErr.message)
  const defects: AnyRow[] = []
  for (const d of defectsRaw || []) {
    defects.push({ ...d, photo_url: await signOne(service, d.photo_url) })
  }

  return { job, company, period: { from, to }, signins, qa, diary, defects }
}
