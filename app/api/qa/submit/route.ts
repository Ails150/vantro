import { verifyFieldToken } from '@/lib/auth'
import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { assertJobBelongsToCaller } from "@/lib/tenant"

export async function POST(request: Request) {
  const installer = verifyFieldToken(request)
  if (!installer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { jobId } = await request.json()
  const service = await createServiceClient()

  const owned = await assertJobBelongsToCaller<{ company_id: string }>(jobId, installer.companyId)
  if (!owned.ok) return owned.response
  const job = owned.job

  // Check if approval already exists
  const { data: existing } = await service
    .from("qa_approvals")
    .select("id")
    .eq("job_id", jobId)
    .eq("user_id", installer.userId)
    .eq("status", "pending")
    .single()

  if (existing) return NextResponse.json({ success: true, message: "Already submitted" })

  const { error } = await service.from("qa_approvals").insert({
    job_id: jobId,
    user_id: installer.userId,
    company_id: job.company_id,
    status: "pending",
    submitted_at: new Date().toISOString()
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ success: true })
}