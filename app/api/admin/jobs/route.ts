import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

// True if a Postgres/PostgREST error is about a given column not existing.
// Lets us gracefully drop a column (e.g. gps_source) when the DB migration that
// adds it hasn't been applied yet, instead of failing the whole write.
function isMissingColumn(error: any, col: string) {
  if (!error) return false
  const blob = `${error.message || ""} ${error.details || ""} ${error.hint || ""}`
  // 42703 = undefined_column (Postgres); PGRST204 = column not in schema cache.
  return (error.code === "42703" || error.code === "PGRST204") && blob.includes(col)
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const service = await createServiceClient()
  const { data: u } = await service.from("users").select("company_id, role").eq("auth_user_id", user.id).single()
  if (!u || !["admin","foreman","superadmin"].includes(u.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const { data: jobs } = await service.from("jobs").select("*, job_checklists(template_id)").eq("company_id", u.company_id).is("archived_at", null).order("created_at", { ascending: false })
  return NextResponse.json({ jobs: jobs || [] })
}

// Create a job via the service role (bypasses the browser client's PostgREST
// schema-cache lag on newly-added columns like gps_source).
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const service = await createServiceClient()
  const { data: u } = await service.from("users").select("company_id, role").eq("auth_user_id", user.id).single()
  if (!u || !["admin","foreman","superadmin"].includes(u.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const b = await request.json().catch(() => ({}))
  const name = (b.name || "").trim()
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 })

  const insert: any = {
    company_id: u.company_id,
    name,
    address: typeof b.address === "string" ? b.address.trim() : "", // jobs.address is NOT NULL; "" for remote
    status: b.status || "active",
    checklist_template_id: b.checklist_template_id || null,
    lat: b.lat ?? null,
    lng: b.lng ?? null,
    gps_source: b.gps_source ?? null,
    start_time: b.start_time || null,
    sign_out_time: b.sign_out_time || null,
    distance_from_site_km: b.distance_from_site_km ?? null,
    contractor: b.contractor || null,
    geofence_radius_metres: b.geofence_radius_metres ?? null,
    required_trades: Array.isArray(b.required_trades) ? b.required_trades : [], // jobs.required_trades is NOT NULL
  }
  let { data, error } = await service.from("jobs").insert(insert).select("id").single()
  if (isMissingColumn(error, "gps_source")) {
    console.warn("[admin/jobs POST] jobs.gps_source missing in DB — creating job without it. Run the gps_source migration.")
    const { gps_source, ...rest } = insert
    ;({ data, error } = await service.from("jobs").insert(rest).select("id").single())
  }
  if (error) {
    console.error("[admin/jobs POST] insert failed:", JSON.stringify({ message: error.message, code: error.code, details: error.details, hint: error.hint }))
    return NextResponse.json(
      { error: error.message || "Could not create job", code: error.code, details: error.details, hint: error.hint },
      { status: 400 }
    )
  }
  return NextResponse.json({ id: data?.id })
}

// Update a job's core fields via the service role (same schema-cache reason).
export async function PUT(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const service = await createServiceClient()
  const { data: u } = await service.from("users").select("company_id, role").eq("auth_user_id", user.id).single()
  if (!u || !["admin","foreman","superadmin"].includes(u.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const b = await request.json().catch(() => ({}))
  const jobId = b.jobId
  if (!jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 })

  const { data: job } = await service.from("jobs").select("id").eq("id", jobId).eq("company_id", u.company_id).maybeSingle()
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const allowed = ["name","address","lat","lng","gps_source","status","start_time","sign_out_time","distance_from_site_km","contractor","geofence_radius_metres","required_trades"]
  const update: any = {}
  for (const k of allowed) if (b[k] !== undefined) update[k] = b[k]
  // jobs.required_trades is NOT NULL — never write null.
  if ("required_trades" in update && !Array.isArray(update.required_trades)) update.required_trades = []
  if (Object.keys(update).length === 0) return NextResponse.json({ error: "No fields to update" }, { status: 400 })

  let { error } = await service.from("jobs").update(update).eq("id", jobId)
  if (isMissingColumn(error, "gps_source")) {
    console.warn("[admin/jobs PUT] jobs.gps_source missing in DB — updating job without it. Run the gps_source migration.")
    const { gps_source, ...rest } = update
    ;({ error } = await service.from("jobs").update(rest).eq("id", jobId))
  }
  if (error) {
    console.error("[admin/jobs PUT] update failed:", JSON.stringify({ message: error.message, code: error.code, details: error.details, hint: error.hint }))
    return NextResponse.json(
      { error: error.message || "Could not update job", code: error.code, details: error.details, hint: error.hint },
      { status: 400 }
    )
  }
  return NextResponse.json({ success: true })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const service = await createServiceClient()
  const { data: u } = await service.from("users").select("company_id, role").eq("auth_user_id", user.id).single()
  if (!u || !["admin","foreman","superadmin"].includes(u.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const { jobId, start_date, end_date, budget_hours } = body
  if (!jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 })

  // Verify job belongs to this company
  const { data: job } = await service.from("jobs").select("id").eq("id", jobId).eq("company_id", u.company_id).maybeSingle()
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const update: any = {}
  if (start_date !== undefined) update.start_date = start_date || null
  if (end_date !== undefined) update.end_date = end_date || null
  if (budget_hours !== undefined) update.budget_hours = budget_hours === null || budget_hours === "" ? null : Number(budget_hours)

  if (Object.keys(update).length === 0) return NextResponse.json({ error: "No fields to update" }, { status: 400 })

  const { error } = await service.from("jobs").update(update).eq("id", jobId)
  if (error) {
    console.error("[admin/jobs PATCH] update failed:", error)
    return NextResponse.json({ error: "Update failed", detail: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
