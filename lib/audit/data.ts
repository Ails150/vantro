/**
 * Audit data layer — single source of truth for fetching audit-pack data
 * from Supabase, with URL signing for evidence media (Cloudflare R2 stays
 * unsigned, Supabase storage paths get a 1-hour signed URL).
 *
 * Used by:
 *   - app/api/audit/report/route.ts (HTML report / client share link)
 *   - app/api/audit/v2/route.ts     (in-app Internal + Compliance views)
 *
 * These were three producers running three different sets of queries against
 * the same tables, which is how the Compliance view ended up rendering columns
 * the API never selected. Everything audit-related goes through here now.
 */

// Both key names are in use across the codebase: the audit/report path was
// written against GOOGLE_MAPS_STATIC_KEY, the v2 path against
// GOOGLE_MAPS_API_KEY. Accept either so a map renders whichever is configured.
const MAPS_KEY =
  process.env.GOOGLE_MAPS_STATIC_KEY ||
  process.env.GOOGLE_MAPS_API_KEY ||
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
  ""
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
export async function signOne(
  service: any,
  value: string | null | undefined,
  ttl: number = SIGNED_URL_TTL
): Promise<string | null> {
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
    const { data, error } = await service.storage.from("vantro-media").createSignedUrl(path, ttl)
    if (error || !data) return value
    return data.signedUrl
  } catch {
    return value
  }
}

export async function signMany(
  service: any,
  values: any,
  ttl: number = SIGNED_URL_TTL
): Promise<string[]> {
  if (!Array.isArray(values)) return []
  const out: string[] = []
  for (const v of values) {
    const s = await signOne(service, v, ttl)
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
  variations: AnyRow[]
  /** Empty unless options.includeWalkthroughs is set. */
  walkthroughs: AnyRow[]
  /** Phase 1.4. Empty unless options.includeAdminLog is set. The human half of
   *  the chain of custody: who approved, resolved, edited or attempted to
   *  delete, and when. */
  adminLog: AnyRow[]
}

export interface FetchAuditDataOptions {
  /** Lifetime of signed media URLs, seconds. Default 1 hour. */
  signedUrlTtl?: number
  /** Walk & Talks are only queried when a caller asks for them. */
  includeWalkthroughs?: boolean
  /** Phase 1.4: fetch the admin audit_log entries for this job and period. */
  includeAdminLog?: boolean
  /**
   * client/external see approved walkthroughs only; internal sees everything
   * that finished processing, so an admin can approve from the audit screen.
   */
  walkthroughView?: "internal" | "client" | "external"
}

/**
 * Pulls the full audit dataset for a job from Supabase.
 * Returns null if the job doesn't exist for the given company.
 *
 * This is the single source of truth — every audit-related route calls this
 * rather than repeating the queries.
 */
export async function fetchAuditData(
  service: any,
  companyId: string,
  jobId: string,
  from: string | null,
  to: string | null,
  options: FetchAuditDataOptions = {}
): Promise<AuditData | null> {
  const ttl = options.signedUrlTtl ?? SIGNED_URL_TTL
  const walkthroughView = options.walkthroughView ?? "internal"
  // `select("*")` on purpose, not laziness. PostgREST fails the WHOLE select on
  // a single unknown column, so an explicit list turns any schema drift on
  // `jobs` into "Job not found" for every audit surface at once. It bit us
  // already: `completed_by` is written by the mark_complete action but does not
  // exist on the live table (see migrations/20260901_baseline_existing_tables
  // .sql, generated from the live PostgREST schema), so naming it explicitly
  // took down the entire pack. One row, so the over-fetch costs nothing.
  const { data: job } = await service
    .from("jobs")
    .select("*")
    .eq("id", jobId).eq("company_id", companyId).single()
  if (!job) return null

  const { data: company } = await service
    .from("companies")
    .select("id, name, multi_trade_enabled, ai_audit_enabled, ai_audit_trial_ends_at, geofence_radius_metres")
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
    .select("id, submitted_at, created_at, state, value, notes, rejection_note, photo_url, video_url, video_ai_summary, checklist_item_id, template_id, reviewed_by, reviewed_at, users!user_id(id, name)")
    .eq("job_id", jobId).order("created_at", { ascending: true })
  if (from) qaQ = qaQ.gte("created_at", from)
  if (to) qaQ = qaQ.lte("created_at", to + "T23:59:59Z")
  const { data: qaRaw, error: qaErr } = await qaQ
  if (qaErr) console.error("[audit] qa error:", qaErr.message)

  // Resolve checklist item labels in one batch
  const itemIds = Array.from(new Set((qaRaw || []).map((q: AnyRow) => q.checklist_item_id).filter(Boolean)))
  const itemMap: Record<string, AnyRow> = {}
  if (itemIds.length > 0) {
    const { data: items, error: itemsErr } = await service.from("checklist_items").select("id, label, trade, template_id, sort_order").in("id", itemIds)
    if (itemsErr) console.error("[audit] checklist_items error:", itemsErr.message)
    for (const it of items || []) itemMap[it.id] = it
  }

  // Checklist template names — deliverables are grouped by these
  const templateIds = Array.from(new Set((qaRaw || []).map((q: AnyRow) => q.template_id).filter(Boolean)))
  const templateMap: Record<string, AnyRow> = {}
  if (templateIds.length > 0) {
    const { data: templates, error: tplErr } = await service.from("checklist_templates").select("id, name").in("id", templateIds)
    if (tplErr) console.error("[audit] checklist_templates error:", tplErr.message)
    for (const t of templates || []) templateMap[t.id] = t
  }

  // Reviewer names for QA sign-offs (reviewed_by is a second FK to users, so
  // it cannot be resolved by the embed above)
  const reviewerIds = Array.from(new Set((qaRaw || []).map((q: AnyRow) => q.reviewed_by).filter(Boolean)))
  const reviewerMap: Record<string, string> = {}
  if (reviewerIds.length > 0) {
    const { data: rs, error: rsErr } = await service.from("users").select("id, name").in("id", reviewerIds)
    if (rsErr) console.error("[audit] reviewers error:", rsErr.message)
    for (const r of rs || []) reviewerMap[r.id] = r.name
  }

  const qa: AnyRow[] = []
  for (const q of qaRaw || []) {
    qa.push({
      ...q,
      photo_url: await signOne(service, q.photo_url, ttl),
      video_url: await signOne(service, q.video_url, ttl),
      checklist_items: q.checklist_item_id ? itemMap[q.checklist_item_id] : null,
      checklist_templates: q.template_id ? templateMap[q.template_id] || null : null,
      reviewed_by_name: q.reviewed_by ? reviewerMap[q.reviewed_by] || null : null,
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
      photo_urls: await signMany(service, d.photo_urls, ttl),
      video_url: await signOne(service, d.video_url, ttl),
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
    defects.push({ ...d, photo_url: await signOne(service, d.photo_url, ttl) })
  }

  // Variations: fetched after defects so we have diary in scope for evidence linking
  let variationsQ = service.from("variations")
    .select("id, created_at, status, ai_detected, ai_confidence, description, estimated_value, approved_value, client_requestor, raised_by, diary_entry_id, approved_at, invoiced_at, notes, users!variations_raised_by_fkey(id, name)")
    .eq("job_id", jobId).order("created_at", { ascending: true })
  if (from) variationsQ = variationsQ.gte("created_at", from)
  if (to) variationsQ = variationsQ.lte("created_at", to + "T23:59:59Z")
  const { data: variationsRaw, error: variationsErr } = await variationsQ
  if (variationsErr) console.error("[audit] variations error:", variationsErr.message)

  // Build a lookup of diary entries by id so each variation can carry its source evidence
  const diaryById: Record<string, AnyRow> = {}
  for (const d of diary) {
    if (d.id) diaryById[d.id] = d
  }
  const variations: AnyRow[] = []
  for (const v of variationsRaw || []) {
    variations.push({
      ...v,
      source_diary: v.diary_entry_id ? diaryById[v.diary_entry_id] || null : null,
    })
  }

  // Walk & Talks — voice-narrated walkthroughs with AI structuring. Only
  // queried when asked for, so the client HTML report pays nothing for them
  // until it renders them.
  let walkthroughs: AnyRow[] = []
  if (options.includeWalkthroughs) {
    let walkQ = service.from("walkthroughs").select(`
      id,
      job_id,
      installer_id,
      recorded_at,
      created_at,
      ai_summary,
      ai_themes,
      ai_sentiment,
      ai_flags,
      ai_sections,
      transcript_full,
      approval_status,
      processing_status,
      duration_seconds,
      clips:walkthrough_clips(stream_video_id, transcript, sequence_number, duration_seconds),
      installer:users!installer_id(id, name)
    `).eq("company_id", companyId).eq("job_id", jobId).order("created_at", { ascending: true })
    if (from) walkQ = walkQ.gte("created_at", from)
    if (to) walkQ = walkQ.lte("created_at", to + "T23:59:59Z")
    const { data: walkRaw, error: walkErr } = await walkQ
    if (walkErr) console.error("[audit] walkthroughs error:", walkErr.message)

    const filtered = (walkRaw || []).filter((w: AnyRow) =>
      walkthroughView === "client" || walkthroughView === "external"
        ? w.approval_status === "approved"
        : w.processing_status === "ready"
    )

    walkthroughs = filtered.map((w: AnyRow) => ({
      id: w.id,
      created_at: w.created_at,
      recorded_at: w.recorded_at,
      summary: w.ai_summary,
      themes: w.ai_themes || [],
      sentiment: w.ai_sentiment,
      flags: w.ai_flags || [],
      sections: w.ai_sections || [],
      transcript: w.transcript_full,
      approval_status: w.approval_status,
      duration_seconds: w.duration_seconds,
      clips: (w.clips || [])
        .sort((a: AnyRow, b: AnyRow) => a.sequence_number - b.sequence_number)
        .map((c: AnyRow) => ({
          stream_video_id: c.stream_video_id,
          transcript: c.transcript,
          sequence_number: c.sequence_number,
          duration_seconds: c.duration_seconds,
        })),
      installer: w.installer || null,
    }))
  }

  // -------------------------------------------------------------------------
  // Phase 1.4: the admin audit log for this job and period.
  // -------------------------------------------------------------------------
  // Everything above records what happened on site. This records what happened
  // to that evidence afterwards -- who approved a QA item, who resolved a
  // defect, who tried to delete something. Without it the pack shows evidence
  // and its current state but not the human decisions in between, which is the
  // half an assessor actually questions.
  let adminLog: AnyRow[] = []
  if (options.includeAdminLog) {
    // Scoped by the entities this job actually owns, so a busy company's log
    // does not leak other jobs' activity into this pack.
    const subjectIds = new Set<string>([jobId])
    for (const r of [...signins, ...qa, ...diary, ...defects, ...variations]) {
      if (r?.id) subjectIds.add(r.id)
    }

    let q = service
      .from("audit_log")
      .select("id, action, entity_type, entity_id, details, created_at, user_id, users(name, initials)")
      .eq("company_id", companyId)
      .in("entity_id", [...subjectIds])
      .order("created_at", { ascending: true })
    if (from) q = q.gte("created_at", from)
    if (to) q = q.lte("created_at", to + "T23:59:59.999Z")

    const { data: logRows } = await q

    // DENYLIST, for the same reason the hash payloads use one: an allowlist of
    // "evidential actions" would silently drop any action added later, and a
    // decision nobody listed is exactly what an audit trail must not lose. Only
    // actions that are plainly reads are excluded.
    const NOISE = /^(view|read|open|list|search|export_view|page_view|login|logout)(_|$)/i
    adminLog = (logRows || []).filter((r: AnyRow) => !NOISE.test(r.action || ""))
  }

  return { job, company, period: { from, to }, signins, qa, diary, defects, variations, walkthroughs, adminLog }
}
