import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

// GET: returns jobs[], installers[], and assignments matrix (job_id, user_id pairs)
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const service = await createServiceClient()
  const { data: u } = await service
    .from("users")
    .select("company_id, role")
    .eq("auth_user_id", user.id)
    .single()

  if (!u || !["admin", "superadmin", "foreman"].includes(u.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const [jobs, team, assignments] = await Promise.all([
    service.from("jobs").select("id, name, address").eq("company_id", u.company_id).eq("status", "active").order("name"),
    service.from("users").select("id, name, role").eq("company_id", u.company_id).in("role", ["installer", "foreman"]).eq("is_active", true).order("name"),
    service.from("job_assignments").select("job_id, user_id").eq("company_id", u.company_id),
  ])

  return NextResponse.json({
    jobs: jobs.data || [],
    team: team.data || [],
    assignments: assignments.data || [],
  })
}

// POST: applies an assignment diff. Body: { add: [{job_id,user_id}], remove: [{job_id,user_id}] }
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const service = await createServiceClient()
  const { data: u } = await service
    .from("users")
    .select("company_id, role")
    .eq("auth_user_id", user.id)
    .single()

  if (!u || !["admin", "superadmin"].includes(u.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  const add = Array.isArray(body.add) ? body.add : []
  const remove = Array.isArray(body.remove) ? body.remove : []

  let added = 0
  let removed = 0

  if (add.length > 0) {
    const rows = add.map((a: any) => ({
      job_id: a.job_id,
      user_id: a.user_id,
      company_id: u.company_id,
    }))
    const { error, data } = await service.from("job_assignments").upsert(rows, { onConflict: "job_id,user_id" }).select()
    if (error) return NextResponse.json({ error: "Could not add assignments", detail: error.message }, { status: 400 })
    added = data?.length || 0
  }

  for (const r of remove) {
    await service.from("job_assignments")
      .delete()
      .eq("company_id", u.company_id)
      .eq("job_id", r.job_id)
      .eq("user_id", r.user_id)
    removed++
  }

  return NextResponse.json({ success: true, added, removed })
}