import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const service = await createServiceClient()
  const { data: u } = await service.from("users").select("company_id, role").eq("auth_user_id", user.id).single()
  if (!u || !["admin","foreman"].includes(u.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const { data: jobs } = await service.from("jobs").select("*, job_checklists(template_id)").eq("company_id", u.company_id).order("created_at", { ascending: false })
  return NextResponse.json({ jobs: jobs || [] })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const service = await createServiceClient()
  const { data: u } = await service.from("users").select("company_id, role").eq("auth_user_id", user.id).single()
  if (!u || !["admin","foreman"].includes(u.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

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
