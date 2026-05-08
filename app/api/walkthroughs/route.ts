import { NextRequest, NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const service = await createServiceClient()
  const { data: u } = await service
    .from("users")
    .select("company_id, role")
    .eq("auth_user_id", user.id)
    .single()
  if (!u) return NextResponse.json({ error: "User not found" }, { status: 404 })

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
      job:jobs(id, name, address),
      installer:users!installer_id(id, name),
      approver:users!approved_by(id, name),
      clips:walkthrough_clips(id, sequence_number, duration_seconds, transcript, stream_video_id)
    `)
    .eq("company_id", u.company_id)
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
