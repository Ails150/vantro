import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { getCallerContext, isDashboardRole } from "@/lib/company-context"

export async function GET(req: NextRequest) {
  const ctx = await getCallerContext()
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  // The company-wide walkthrough list (transcripts, AI flags, every installer).
  if (!isDashboardRole(ctx.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  if (!ctx.companyId) return NextResponse.json({ error: "No company selected" }, { status: 400 })

  const service = await createServiceClient()

  const { searchParams } = new URL(req.url)
  const filter = searchParams.get("filter") || "all"
  const status = searchParams.get("status") || "all"

  let q = service
    .from("walkthroughs")
    .select(`
      id, company_id, job_id, installer_id, recorded_at, gps_lat, gps_lng,
      duration_seconds, transcript_full, ai_summary, ai_sections, ai_themes,
      ai_sentiment, ai_flags, approval_status, approved_by, approved_at,
      rejected_reason, created_at,
      processing_status, processing_attempts, processing_started_at, processing_error,
      job:jobs(id, name, address),
      installer:users!installer_id(id, name),
      approver:users!approved_by(id, name),
      clips:walkthrough_clips(id, sequence_number, duration_seconds, transcript, stream_video_id)
    `)
    .eq("company_id", ctx.companyId)
    .order("recorded_at", { ascending: false })

  if (status !== "all") {
    q = q.eq("approval_status", status)
  }

  if (filter === "today") {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    q = q.gte("recorded_at", start.toISOString())
  } else if (filter === "7d") {
    q = q.gte("recorded_at", new Date(Date.now() - 7 * 86400000).toISOString())
  } else if (filter === "30d") {
    q = q.gte("recorded_at", new Date(Date.now() - 30 * 86400000).toISOString())
  }

  const { data, error } = await q
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ walkthroughs: data || [] })
}
