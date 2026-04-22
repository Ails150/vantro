import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const jobId = searchParams.get("jobId")
  if (!jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 })

  const service = await createServiceClient()
  const { data: u } = await service.from("users").select("company_id, role").eq("auth_user_id", user.id).single()
  if (!u || !["admin","foreman"].includes(u.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  // Verify the job belongs to this user's company before returning anything
  const { data: job } = await service.from("jobs").select("id").eq("id", jobId).eq("company_id", u.company_id).maybeSingle()
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const { data } = await service.from("job_checklists").select("template_id").eq("job_id", jobId)
  return NextResponse.json({ templateIds: (data||[]).map((r:any) => r.template_id) })
}