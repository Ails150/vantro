// app/api/admin/visit-assignments/route.ts
//
// POST: assign an installer to a job on a specific date.
// If a visit exists for that job on that date, attach the assignment to it.
// Otherwise create a new visit, then attach the assignment.

import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const service = await createServiceClient()
  const { data: admin } = await service
    .from("users")
    .select("id, company_id, role")
    .eq("auth_user_id", user.id)
    .single()
  if (!admin || !["admin", "foreman"].includes(admin.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const body = await request.json()
  const { job_id, user_id, date, role: assignmentRole } = body

  if (!job_id || !user_id || !date)
    return NextResponse.json({ error: "job_id, user_id, date required" }, { status: 400 })

  // Find an existing visit for this job overlapping this date
  const dayStart = `${date}T00:00:00`
  const dayEnd = `${date}T23:59:59`
  const { data: existingVisits } = await service
    .from("job_visits")
    .select("id, start_at, end_at")
    .eq("company_id", admin.company_id)
    .eq("job_id", job_id)
    .lte("start_at", dayEnd)
    .or(`end_at.is.null,end_at.gte.${dayStart}`)
    .limit(1)

  let visit_id: string
  if (existingVisits && existingVisits.length > 0) {
    visit_id = existingVisits[0].id
  } else {
    // Create a new single-day visit
    const { data: newVisit, error: visitErr } = await service
      .from("job_visits")
      .insert({
        company_id: admin.company_id,
        job_id,
        start_at: dayStart,
        end_at: dayEnd,
        status: "scheduled",
      })
      .select("id")
      .single()
    if (visitErr || !newVisit)
      return NextResponse.json({ error: visitErr?.message || "Failed to create visit" }, { status: 500 })
    visit_id = newVisit.id
  }

  // Avoid duplicate assignment
  const { data: existing } = await service
    .from("visit_assignments")
    .select("id")
    .eq("visit_id", visit_id)
    .eq("user_id", user_id)
    .limit(1)
  if (existing && existing.length > 0) {
    return NextResponse.json({ assignment: existing[0], duplicate: true })
  }

  const { data: assignment, error: insertErr } = await service
    .from("visit_assignments")
    .insert({
      company_id: admin.company_id,
      visit_id,
      user_id,
      role: assignmentRole || "installer",
    })
    .select("id, visit_id, user_id, role")
    .single()

  if (insertErr || !assignment)
    return NextResponse.json({ error: insertErr?.message || "Insert failed" }, { status: 500 })

  return NextResponse.json({ assignment, visit_id })
}
