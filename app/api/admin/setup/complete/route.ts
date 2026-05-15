import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

export async function POST() {
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

  const [jobs, team, assignments, schedules] = await Promise.all([
    service.from("jobs").select("id", { count: "exact", head: true }).eq("company_id", u.company_id),
    service.from("users").select("id", { count: "exact", head: true }).eq("company_id", u.company_id).in("role", ["installer", "foreman"]),
    service.from("job_assignments").select("id", { count: "exact", head: true }).eq("company_id", u.company_id),
    service.from("user_shifts").select("id", { count: "exact", head: true }).eq("company_id", u.company_id),
  ])

  if (!jobs.count || !team.count || !assignments.count || !schedules.count) {
    return NextResponse.json({
      error: "Setup not complete",
      jobs: jobs.count, team: team.count, assignments: assignments.count, schedules: schedules.count,
    }, { status: 400 })
  }

  const { error } = await service
    .from("companies")
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq("id", u.company_id)

  if (error) {
    return NextResponse.json({ error: "Could not mark complete", detail: error.message }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}