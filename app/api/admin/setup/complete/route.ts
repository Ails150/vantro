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

  // ONE JOB. That is the whole requirement to leave setup.
  //
  // This used to demand a job AND a worker AND an assignment AND a working-hours
  // pattern, and refused to set onboarding_completed_at until all four existed
  // -- while app/admin/page.tsx bounced every visit to /admin back here until
  // it was set. A subcontractor who wanted to photograph one job had to staff a
  // rota first. Working hours decide nothing about a capture; they size a
  // payroll week that a solo trader may never run.
  //
  // What is missing does not vanish: the dashboard asks for assignments and
  // hours as prompts on Today, where they can be answered when they matter
  // and ignored when they do not. A prompt costs a line; a locked door costs
  // the customer.
  const jobs = await service
    .from("jobs").select("id", { count: "exact", head: true }).eq("company_id", u.company_id)

  if (!jobs.count) {
    return NextResponse.json({
      error: "Add a job before finishing setup",
      jobs: jobs.count ?? 0,
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