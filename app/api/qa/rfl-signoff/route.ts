import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

// Supervisor (RFL) per-item sign-off on a QA submission. Sets RFL initials +
// today's date, and an optional remedial-action note. Admin/foreman/superadmin.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const service = await createServiceClient()
  const { data: u } = await service.from("users").select("id, company_id, role").eq("auth_user_id", user.id).single()
  if (!u || !["admin", "foreman", "superadmin"].includes(u.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const submissionId = body.submissionId
  if (!submissionId) return NextResponse.json({ error: "Missing submissionId" }, { status: 400 })

  // Verify the submission belongs to this company.
  const { data: sub } = await service.from("qa_submissions").select("id").eq("id", submissionId).eq("company_id", u.company_id).maybeSingle()
  if (!sub) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const rflInitials = typeof body.rfl_initials === "string" ? body.rfl_initials.trim().slice(0, 12) : ""
  const today = new Date().toISOString().slice(0, 10)

  const update: any = {
    rfl_initials: rflInitials || null,
    rfl_date: rflInitials ? today : null,
    reviewed_by: u.id,
    reviewed_at: new Date().toISOString(),
  }
  if (body.remedial_action !== undefined) {
    update.remedial_action = typeof body.remedial_action === "string" ? (body.remedial_action.trim() || null) : null
  }

  const { error } = await service.from("qa_submissions").update(update).eq("id", submissionId)
  if (error) {
    console.error("[api/qa/rfl-signoff] update failed:", error)
    return NextResponse.json({ error: "Could not save sign-off. Run the QA sign-off migration.", detail: error.message }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}
