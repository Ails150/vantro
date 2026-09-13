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
  /**
   * Toolbox talks given on this job in the period, each with the crew it was
   * for and who actually signed. The outstanding list is the compliance fact:
   * a talk everyone signed and a talk nobody signed look identical from the
   * talk row alone.
   */
  toolboxTalks: AnyRow[]
  /**
   * The RAMS in force for this job, its version history, and who has signed the
   * current version. Signatures are against a version, so "signed" here always
   * means "signed the one in force" -- a revision correctly resets everyone.
   */
  /**
   * Near misses, injuries and hazards on this job. Not period-filtered on
   * `occurred_at` alone: an incident reported inside the window about something
   * that happened just before it still belongs to this pack.
   */
  incidents: AnyRow[]
  rams: {
    current: AnyRow | null
    versions: AnyRow[]
    signatures: AnyRow[]
    outstanding: AnyRow[]
    crewSize: number
  }
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
    .select("id, name, multi_trade_enabled, plan, geofence_radius_metres")
    .eq("id", companyId).single()

  let signinsQ = service.from("signins")
    .select("id, signed_in_at, signed_out_at, lat, lng, sign_out_lat, sign_out_lng, distance_from_site_metres, sign_out_distance_metres, within_range, sign_out_within_range, hours_worked, flagged, flag_reason, departed_early, early_departure_minutes, auto_closed, auto_closed_reason, rams_check, users!user_id(id, name, trades)")
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
  // Toolbox talks, with signatures and the gap.
  // -------------------------------------------------------------------------
  // Always fetched, not behind an option: a compliance pack that silently omits
  // safety briefings because a caller forgot a flag is the failure mode this
  // whole layer exists to prevent.
  //
  // `outstanding` is computed against the crew assigned to the job, which is
  // what makes an unsigned talk visible at all. The signature image itself is
  // deliberately NOT carried here: the pack needs to state who attested and
  // when, and shipping several hundred kilobytes of stroke data through every
  // audit surface to render a squiggle is not worth it. The rows remain in
  // toolbox_talk_signatures for anyone who needs to see the mark.
  const { data: talkRows, error: talkErr } = await service
    .from("toolbox_talks")
    .select("id, title, notes, document_url, delivered_at, locked_at, " +
            "delivered_by_user:users!toolbox_talks_delivered_by_fkey(id, name), " +
            "signatures:toolbox_talk_signatures(id, user_id, signed_at, lat, lng, users(id, name))")
    .eq("company_id", companyId)
    .eq("job_id", jobId)
    .is("archived_at", null)
    .order("delivered_at", { ascending: true })
  if (talkErr) console.error("[audit] toolbox talks error:", talkErr.message)

  const { data: crewRows } = await service
    .from("job_assignments")
    .select("user_id, users(id, name, is_active)")
    .eq("job_id", jobId)
  const crew = (crewRows || [])
    .map((a: AnyRow) => a.users)
    .filter((u: AnyRow) => u && u.is_active !== false)

  const inPeriod = (ts: string | null) => {
    if (!ts) return false
    if (from && ts < from) return false
    if (to && ts > to + "T23:59:59.999Z") return false
    return true
  }

  const toolboxTalks: AnyRow[] = (talkRows || [])
    .filter((t: AnyRow) => (!from && !to) || inPeriod(t.delivered_at))
    .map((t: AnyRow) => {
      const signatures = (t.signatures || []).map((sg: AnyRow) => ({
        // The signature's own id, so the pack can find its evidence hash.
        // Without it the row is printed in the report but contributes nothing
        // to the merkle root, which is a weaker claim than it looks.
        id: sg.id,
        user_id: sg.user_id,
        name: sg.users?.name || "Unknown",
        signed_at: sg.signed_at,
        located: sg.lat != null && sg.lng != null,
      }))
      const signedIds = new Set(signatures.map((sg: AnyRow) => sg.user_id))
      return {
        id: t.id,
        title: t.title,
        notes: t.notes,
        document_url: t.document_url,
        delivered_at: t.delivered_at,
        delivered_by: t.delivered_by_user?.name || null,
        locked: !!t.locked_at,
        crew_size: crew.length,
        signatures: signatures.sort((a: AnyRow, b: AnyRow) =>
          String(a.signed_at).localeCompare(String(b.signed_at))),
        outstanding: crew
          .filter((u: AnyRow) => !signedIds.has(u.id))
          .map((u: AnyRow) => ({ user_id: u.id, name: u.name }))
          .sort((a: AnyRow, b: AnyRow) => a.name.localeCompare(b.name)),
      }
    })

  // -------------------------------------------------------------------------
  // Incidents.
  // -------------------------------------------------------------------------
  // Filtered on reported_at rather than occurred_at, because an incident
  // reported during the period is part of what happened during the period even
  // if the event itself was a day earlier. Both timestamps are carried so a
  // reader can see the lag, which is itself worth seeing: a week between the
  // two is a reporting-culture finding.
  let incidentsQ = service
    .from("incidents")
    .select("id, kind, description, photo_urls, photo_paths, occurred_at, reported_at, " +
            "lat, lng, status, acknowledged_at, closed_at, closure_notes, " +
            "reporter:users!incidents_reported_by_fkey(id, name), " +
            "ack:users!incidents_acknowledged_by_fkey(name), " +
            "closer:users!incidents_closed_by_fkey(name)")
    .eq("company_id", companyId)
    .eq("job_id", jobId)
    .order("reported_at", { ascending: true })
  if (from) incidentsQ = incidentsQ.gte("reported_at", from)
  if (to) incidentsQ = incidentsQ.lte("reported_at", to + "T23:59:59Z")
  const { data: incidentRows, error: incidentErr } = await incidentsQ
  if (incidentErr) console.error("[audit] incidents error:", incidentErr.message)

  const incidents: AnyRow[] = []
  for (const i of incidentRows || []) {
    const urls: string[] = []
    for (const u of i.photo_urls || []) {
      const signed = await signOne(service, u, ttl)
      if (signed) urls.push(signed)
    }
    incidents.push({
      id: i.id,
      kind: i.kind,
      description: i.description,
      photo_urls: urls,
      photo_paths: i.photo_paths || [],
      occurred_at: i.occurred_at,
      reported_at: i.reported_at,
      reported_by: i.reporter?.name || "Unknown",
      located: i.lat != null && i.lng != null,
      status: i.status,
      acknowledged_at: i.acknowledged_at,
      acknowledged_by: i.ack?.name || null,
      closed_at: i.closed_at,
      closed_by: i.closer?.name || null,
      closure_notes: i.closure_notes,
    })
  }

  // -------------------------------------------------------------------------
  // RAMS: the method statement in force, its history, and the signature gap.
  // -------------------------------------------------------------------------
  // Not period-filtered. A RAMS uploaded before the reporting window still
  // governs the work inside it, and dropping it because it predates `from`
  // would report a job with no method statement -- the opposite of the truth.
  // The version history is included so the pack shows a revision happening
  // mid-job, which is exactly when signatures go stale.
  const { data: ramsVersions } = await service
    .from("rams_documents")
    .select("id, version, title, notes, document_url, document_path, document_sha256, " +
            "created_at, superseded_at, archived_at, " +
            "uploaded_by_user:users!rams_documents_uploaded_by_fkey(id, name)")
    .eq("company_id", companyId)
    .eq("job_id", jobId)
    .is("archived_at", null)
    .order("version", { ascending: true })

  const ramsCurrent = (ramsVersions || []).find((v: AnyRow) => !v.superseded_at) || null

  let ramsSignatures: AnyRow[] = []
  if (ramsCurrent) {
    const { data: sigs } = await service
      .from("rams_signatures")
      .select("id, user_id, signed_at, read_seconds, lat, lng, users(id, name)")
      .eq("rams_id", ramsCurrent.id)
      .order("signed_at", { ascending: true })
    ramsSignatures = (sigs || []).map((sg: AnyRow) => ({
      id: sg.id,
      user_id: sg.user_id,
      name: sg.users?.name || "Unknown",
      signed_at: sg.signed_at,
      read_seconds: sg.read_seconds,
      located: sg.lat != null && sg.lng != null,
    }))
  }
  const ramsSignedIds = new Set(ramsSignatures.map((sg: AnyRow) => sg.user_id))

  const rams = {
    current: ramsCurrent
      ? {
          id: ramsCurrent.id,
          version: ramsCurrent.version,
          title: ramsCurrent.title,
          notes: ramsCurrent.notes,
          document_url: ramsCurrent.document_url,
          document_path: ramsCurrent.document_path,
          document_sha256: ramsCurrent.document_sha256,
          created_at: ramsCurrent.created_at,
          uploaded_by: ramsCurrent.uploaded_by_user?.name || null,
        }
      : null,
    versions: (ramsVersions || []).map((v: AnyRow) => ({
      id: v.id,
      version: v.version,
      title: v.title,
      created_at: v.created_at,
      superseded_at: v.superseded_at,
      uploaded_by: v.uploaded_by_user?.name || null,
    })),
    signatures: ramsSignatures,
    outstanding: ramsCurrent
      ? crew
          .filter((u: AnyRow) => !ramsSignedIds.has(u.id))
          .map((u: AnyRow) => ({ user_id: u.id, name: u.name }))
          .sort((a: AnyRow, b: AnyRow) => a.name.localeCompare(b.name))
      : [],
    crewSize: crew.length,
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
    for (const r of [...signins, ...qa, ...diary, ...defects, ...variations, ...toolboxTalks, ...rams.versions, ...incidents]) {
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

  return { job, company, period: { from, to }, signins, qa, diary, defects, variations, walkthroughs, toolboxTalks, rams, incidents, adminLog }
}
