// app/api/admin/visit-assignments/[id]/route.ts
//
// PATCH: move an assignment. Body can contain { user_id?, target_date? }
//   - user_id: change which installer is assigned
//   - target_date: change to a different visit on that date (or new visit)
// DELETE: remove the assignment.

import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  const service = await createServiceClient()
  const { data: admin } = await service
    .from("users")
    .select("id, company_id, role")
    .eq("auth_user_id", user.id)
    .single()
  if (!admin || !["admin", "foreman"].includes(admin.role))
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  return { service, admin }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const { service, admin } = auth

  const body = await request.json()
  const { user_id, target_date } = body

  // Load the existing assignment + its visit (for job_id)
  const { data: existing } = await service
    .from("visit_assignments")
    .select("id, visit_id, user_id, role, visits:job_visits(id, job_id, company_id)")
    .eq("id", id)
    .single()
  if (!existing) return NextResponse.json({ error: "Assignment not found" }, { status: 404 })

  const visit = (existing as any).visits
  if (!visit || visit.company_id !== admin.company_id)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  // Case 1: only user_id changed (same visit, different installer)
  if (user_id && !target_date) {
    const { data: updated, error } = await service
      .from("visit_assignments")
      .update({ user_id })
      .eq("id", id)
      .select("id, visit_id, user_id, role")
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ assignment: updated })
  }

  // Case 2: target_date changed (move to different visit, possibly new)
  if (target_date) {
    const dayStart = `${target_date}T00:00:00`
    const dayEnd = `${target_date}T23:59:59`
    const { data: targetVisits } = await service
      .from("job_visits")
      .select("id")
      .eq("company_id", admin.company_id)
      .eq("job_id", visit.job_id)
      .lte("start_at", dayEnd)
      .or(`end_at.is.null,end_at.gte.${dayStart}`)
      .limit(1)

    let new_visit_id: string
    if (targetVisits && targetVisits.length > 0) {
      new_visit_id = targetVisits[0].id
    } else {
      const { data: created, error: createErr } = await service
        .from("job_visits")
        .insert({
          company_id: admin.company_id,
          job_id: visit.job_id,
          start_at: dayStart,
          end_at: dayEnd,
          status: "scheduled",
        })
        .select("id")
        .single()
      if (createErr || !created)
        return NextResponse.json({ error: createErr?.message || "Failed to create visit" }, { status: 500 })
      new_visit_id = created.id
    }

    const finalUserId = user_id || existing.user_id
    const { data: updated, error } = await service
      .from("visit_assignments")
      .update({ visit_id: new_visit_id, user_id: finalUserId })
      .eq("id", id)
      .select("id, visit_id, user_id, role")
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ assignment: updated })
  }

  return NextResponse.json({ error: "Nothing to update" }, { status: 400 })
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const { service, admin } = auth

  // Verify ownership before delete
  const { data: existing } = await service
    .from("visit_assignments")
    .select("id, visits:job_visits(company_id)")
    .eq("id", id)
    .single()
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if ((existing as any).visits?.company_id !== admin.company_id)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { error } = await service.from("visit_assignments").delete().eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
