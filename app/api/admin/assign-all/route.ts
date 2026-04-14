import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const service = await createServiceClient()
  const { data: u } = await service.from("users").select("company_id, role").eq("auth_user_id", user.id).single()
  if (!u || !["admin", "foreman"].includes(u.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { jobId } = await request.json()
  if (!jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 })

  // Get all installers in the company
  const { data: installers } = await service.from("users")
    .select("id")
    .eq("company_id", u.company_id)
    .eq("role", "installer")

  if (!installers || installers.length === 0) {
    return NextResponse.json({ error: "No installers found" }, { status: 400 })
  }

  // Get existing assignments
  const { data: existing } = await service.from("job_assignments")
    .select("user_id")
    .eq("job_id", jobId)

  const existingIds = new Set((existing || []).map((e: any) => e.user_id))

  // Insert only new assignments
  const newAssignments = installers
    .filter(i => !existingIds.has(i.id))
    .map(i => ({ job_id: jobId, user_id: i.id, company_id: u.company_id }))

  if (newAssignments.length > 0) {
    await service.from("job_assignments").insert(newAssignments)
  }

  return NextResponse.json({
    success: true,
    assigned: newAssignments.length,
    alreadyAssigned: existingIds.size,
    total: installers.length,
  })
}