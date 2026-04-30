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
 * Convert a stored value into a signed URL.
 * Accepts either:
 *  - a storage path (e.g. "company-id/job-id/item/123.jpg")
 *  - a public/legacy URL containing "/vantro-media/" — we extract the path after that
 * Returns null on failure.
 */
async function signOne(service: any, value: string | null | undefined): Promise<string | null> {
  if (!value) return null
  let path = value
  const marker = "/vantro-media/"
  const idx = value.indexOf(marker)
  if (idx >= 0) path = value.substring(idx + marker.length)
  if (path.startsWith("/")) path = path.substring(1)
  if (!path) return null
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
  // 1. Auth — admin user
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const service = await createServiceClient()

  // Resolve company_id via auth_user_id lookup
  const { data: appUser, error: userErr } = await service
    .from("users")
    .select("id, company_id, role")
    .eq("auth_user_id", user.id)
    .single()
  if (userErr || !appUser) {
    return NextResponse.json({ error: "User not found" }, { status: 403 })
  }
  const companyId = appUser.company_id

  // 2. Params
  const { searchParams } = new URL(request.url)
  const jobId = searchParams.get("jobId")
  const from = searchParams.get("from")
  const to = searchParams.get("to")
  if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 })

  // 3. Job (with required_trades) — must belong to caller's company
  const { data: job, error: jobErr } = await service
    .from("jobs")
    .select("id, name, address, lat, lng, company_id, required_trades")
    .eq("id", jobId)
    .eq("company_id", companyId)
    .single()
  if (jobErr || !job) return NextResponse.json({ error: "Job not found" }, { status: 404 })

  // 4. Company flags + trades catalogue
  const { data: company } = await service
    .from("companies")
    .select("id, name, multi_trade_enabled, ai_audit_enabled, ai_audit_trial_ends_at")
    .eq("id", companyId)
    .single()

  const multi_trade_enabled = !!company?.multi_trade_enabled
  const ai_audit_enabled = !!company?.ai_audit_enabled

  let companyTrades: AnyRow[] = []
  if (multi_trade_enabled) {
    const { data: trades } = await service
      .from("company_trades")
      .select("id, name, slug")
      .eq("company_id", companyId)
      .order("name", { ascending: true })
    companyTrades = trades || []
  }

  // 5. Sign-ins (with user trades + map URLs in/out)
  let signinsQuery = service
    .from("signins")
    .select(
      "id, signed_in_at, signed_out_at, lat, lng, sign_out_lat, sign_out_lng, distance_metres, sign_out_distance_metres, users(id, name, trades)"
    )
    .eq("job_id", jobId)
    .order("signed_in_at", { ascending: true })
  if (from) signinsQuery = signinsQuery.gte("signed_in_at", from)
  if (to) signinsQuery = signinsQuery.lte("signed_in_at", to + "T23:59:59Z")
  const { data: signinsRaw } = await signinsQuery

  const signins = (signinsRaw || []).map((s: AnyRow) => ({
    ...s,
    map_in_url: staticMapUrl(s.lat, s.lng),
    map_out_url: staticMapUrl(s.sign_out_lat, s.sign_out_lng),
  }))

  // 6. QA submissions (+ checklist_item.trade, signed photos, video summary)
  let qaQuery = service
    .from("qa_submissions")
    .select(
      "id, submitted_at, result, note, photo_url, photo_urls, video_url, video_ai_summary, users(id, name), checklist_items(id, label, trade)"
    )
    .eq("job_id", jobId)
    .order("submitted_at", { ascending: true })
  if (from) qaQuery = qaQuery.gte("submitted_at", from)
  if (to) qaQuery = qaQuery.lte("submitted_at", to + "T23:59:59Z")
  const { data: qaRaw } = await qaQuery

  const qa: AnyRow[] = []
  for (const q of qaRaw || []) {
    qa.push({
      ...q,
      photo_url: await signOne(service, q.photo_url),
      photo_urls: await signMany(service, q.photo_urls),
      video_url: await signOne(service, q.video_url),
    })
  }

  // 7. Diary entries (+ signed photos, video summary)
  let diaryQuery = service
    .from("diary_entries")
    .select(
      "id, created_at, severity, note, ai_summary, photo_urls, video_url, video_ai_summary, users(id, name)"
    )
    .eq("job_id", jobId)
    .order("created_at", { ascending: true })
  if (from) diaryQuery = diaryQuery.gte("created_at", from)
  if (to) diaryQuery = diaryQuery.lte("created_at", to + "T23:59:59Z")
  const { data: diaryRaw } = await diaryQuery

  const diary: AnyRow[] = []
  for (const d of diaryRaw || []) {
    diary.push({
      ...d,
      photo_urls: await signMany(service, d.photo_urls),
      video_url: await signOne(service, d.video_url),
    })
  }

  // 8. Defects (NEW — was missing entirely)
  let defectsQuery = service
    .from("defects")
    .select(
      "id, created_at, status, severity, note, photo_url, photo_urls, users(id, name)"
    )
    .eq("job_id", jobId)
    .order("created_at", { ascending: true })
  if (from) defectsQuery = defectsQuery.gte("created_at", from)
  if (to) defectsQuery = defectsQuery.lte("created_at", to + "T23:59:59Z")
  const { data: defectsRaw } = await defectsQuery

  const defects: AnyRow[] = []
  for (const d of defectsRaw || []) {
    defects.push({
      ...d,
      photo_url: await signOne(service, d.photo_url),
      photo_urls: await signMany(service, d.photo_urls),
    })
  }

  // 9. Response
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
