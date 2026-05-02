"""
Vantro AI Audit Pack - Patch 2.1 of 6 (CORRECTIVE)
====================================================
Fixes Patch 2 column-name mismatches that caused all queries to silently fail
and return empty arrays.

What changed vs Patch 2:
  - signins: distance_metres -> distance_from_site_metres (+ legacy alias)
  - qa_submissions: result -> state, note -> notes, photo_urls removed (no such column)
                    (legacy aliases provided so AuditTab keeps working)
  - diary_entries: note -> entry_text, severity -> ai_alert_type (no such column)
                   (legacy aliases provided)
  - defects: note -> description, photo_urls dropped (no array column)
  - All queries now log errors to console (Vercel function logs) instead of
    silently returning empty data.

Drop-in replacement. Run from C:\\vantro:
    python patch2_1_audit_route.py
"""
import os
import sys
import shutil
import datetime

ROOT = r"C:\vantro"
TARGET = os.path.join(ROOT, "app", "api", "audit", "route.ts")
BACKUP_DIR = os.path.join(ROOT, "_backups")

NEW_CONTENT = r"""import { NextResponse } from "next/server"
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

  // 3. Job
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
    const { data: trades, error: tradesErr } = await service
      .from("company_trades")
      .select("id, name, slug")
      .eq("company_id", companyId)
      .order("name", { ascending: true })
    if (tradesErr) console.error("[audit] companyTrades error:", tradesErr.message)
    companyTrades = trades || []
  }

  // 5. Sign-ins — column names corrected to match schema
  let signinsQuery = service
    .from("signins")
    .select(
      "id, signed_in_at, signed_out_at, lat, lng, sign_out_lat, sign_out_lng, distance_from_site_metres, sign_out_distance_metres, within_range, sign_out_within_range, hours_worked, flagged, flag_reason, departed_early, early_departure_minutes, auto_closed, auto_closed_reason, users(id, name, trades)"
    )
    .eq("job_id", jobId)
    .order("signed_in_at", { ascending: true })
  if (from) signinsQuery = signinsQuery.gte("signed_in_at", from)
  if (to) signinsQuery = signinsQuery.lte("signed_in_at", to + "T23:59:59Z")
  const { data: signinsRaw, error: signinsErr } = await signinsQuery
  if (signinsErr) console.error("[audit] signins error:", signinsErr.message)

  const signins = (signinsRaw || []).map((s: AnyRow) => ({
    ...s,
    // legacy alias for AuditTab compatibility
    distance_metres: s.distance_from_site_metres,
    map_in_url: staticMapUrl(s.lat, s.lng),
    map_out_url: staticMapUrl(s.sign_out_lat, s.sign_out_lng),
  }))

  // 6. QA submissions — corrected: state (not result), notes (not note), no photo_urls array
  let qaQuery = service
    .from("qa_submissions")
    .select(
      "id, submitted_at, created_at, state, value, notes, rejection_note, photo_url, video_url, video_ai_summary, video_ai_summary_at, users(id, name), checklist_items(id, label, trade)"
    )
    .eq("job_id", jobId)
    .order("submitted_at", { ascending: true })
  if (from) qaQuery = qaQuery.gte("submitted_at", from)
  if (to) qaQuery = qaQuery.lte("submitted_at", to + "T23:59:59Z")
  const { data: qaRaw, error: qaErr } = await qaQuery
  if (qaErr) console.error("[audit] qa error:", qaErr.message)

  const qa: AnyRow[] = []
  for (const q of qaRaw || []) {
    qa.push({
      ...q,
      // legacy aliases for AuditTab compatibility
      result: q.state,
      note: q.notes,
      photo_url: await signOne(service, q.photo_url),
      photo_urls: q.photo_url ? [await signOne(service, q.photo_url)].filter(Boolean) : [],
      video_url: await signOne(service, q.video_url),
    })
  }

  // 7. Diary — corrected: entry_text (not note), no severity column (use ai_alert_type as severity proxy)
  let diaryQuery = service
    .from("diary_entries")
    .select(
      "id, created_at, entry_text, ai_alert_type, ai_summary, photo_urls, video_url, video_ai_summary, video_ai_summary_at, replied_at, replied_by, reply, users(id, name)"
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
      // legacy aliases for AuditTab compatibility
      note: d.entry_text,
      severity: d.ai_alert_type,
      photo_urls: await signMany(service, d.photo_urls),
      video_url: await signOne(service, d.video_url),
    })
  }

  // 8. Defects — corrected: description (not note), no photo_urls array, no users() join (defects table has user_id but check if FK exists)
  let defectsQuery = service
    .from("defects")
    .select(
      "id, created_at, status, severity, description, photo_url, resolution_note, resolved_at, resolved_by, user_id, users(id, name)"
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
"""


def main() -> int:
    if not os.path.isfile(TARGET):
        print(f"ERROR: target not found: {TARGET}")
        return 1

    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_path = os.path.join(BACKUP_DIR, f"audit-route.ts.{stamp}.bak")
    shutil.copy2(TARGET, backup_path)
    print(f"[1/3] Backed up old route -> {backup_path}")

    old_lines = sum(1 for _ in open(TARGET, "r", encoding="utf-8", errors="ignore"))
    print(f"      Old file: {old_lines} lines")

    with open(TARGET, "w", encoding="utf-8", newline="\n") as f:
        f.write(NEW_CONTENT)
    new_lines = NEW_CONTENT.count("\n")
    print(f"[2/3] Wrote new route -> {TARGET} ({new_lines} lines)")

    body = open(TARGET, "r", encoding="utf-8").read()
    markers = [
        "distance_from_site_metres",
        "entry_text",
        "ai_alert_type",
        "description",
        ".from(\"defects\")",
        "console.error",
        "video_ai_summary",
        "staticMapUrl",
        "createSignedUrl",
        "auth_user_id",
        "required_trades",
        "multi_trade_enabled",
        "companyTrades",
        "ai_audit_enabled",
    ]
    missing = [m for m in markers if m not in body]
    if missing:
        print(f"[3/3] FAIL — markers missing: {missing}")
        print(f"      Restoring backup")
        shutil.copy2(backup_path, TARGET)
        return 2

    print(f"[3/3] OK — all {len(markers)} markers present")
    print()
    print("Next steps:")
    print("  cd C:\\vantro")
    print("  git add app/api/audit/route.ts")
    print('  git commit -m "Patch 2.1/6: audit route — corrected column names + error logging"')
    print("  git push origin master")
    return 0


if __name__ == "__main__":
    sys.exit(main())
