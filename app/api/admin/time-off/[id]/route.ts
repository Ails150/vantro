// app/api/admin/time-off/[id]/route.ts
//
// Approve or reject a time-off entry.
//   PATCH /api/admin/time-off/<id>  body: { status: 'approved' | 'rejected', rejection_reason?: string }

import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const service = await createServiceClient()
  const { data: admin } = await service
    .from("users")
    .select("id, company_id, role")
    .eq("auth_user_id", user.id)
    .single()
  if (!admin || !["admin", "foreman"].includes(admin.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { status, rejection_reason } = (await request.json()) as {
    status?: "approved" | "rejected"
    rejection_reason?: string
  }
  if (status !== "approved" && status !== "rejected")
    return NextResponse.json(
      { error: "status must be 'approved' or 'rejected'" },
      { status: 400 }
    )

  // Verify entry belongs to admin's company
  const { data: entry } = await service
    .from("time_off_entries")
    .select("id, company_id, status")
    .eq("id", id)
    .single()
  if (!entry || entry.company_id !== admin.company_id)
    return NextResponse.json({ error: "Not found" }, { status: 404 })

  const updates: Record<string, any> = {
    status,
    approved_by: admin.id,
    approved_at: new Date().toISOString(),
  }
  if (status === "rejected") {
    updates.rejection_reason = rejection_reason || null
  } else {
    updates.rejection_reason = null
  }

  const { data: updated, error } = await service
    .from("time_off_entries")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single()

  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 })

  // TODO Phase 5: trigger push notification to the installer here

  return NextResponse.json({ entry: updated })
}
