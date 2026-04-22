import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { verifyInstallerToken } from "@/lib/auth"

export async function POST(request: Request) {
  const installer = verifyInstallerToken(request)
  if (!installer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  const { jobId, stage, videoUrl, streamUid, videoDurationSeconds, lat, lng } = body

  if (!jobId || !stage) return NextResponse.json({ error: "Missing jobId or stage" }, { status: 400 })
  if (!["start", "progress", "completion"].includes(stage)) {
    return NextResponse.json({ error: "Invalid stage" }, { status: 400 })
  }

  const service = await createServiceClient()

  // Verify job belongs to installer's company
  const { data: me } = await service.from("users").select("company_id").eq("id", installer.userId).single()
  if (!me?.company_id) return NextResponse.json({ error: "No company" }, { status: 400 })

  const { data: job } = await service.from("jobs").select("id, company_id").eq("id", jobId).eq("company_id", me.company_id).maybeSingle()
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 })

  // Find active signin for today to link this walkthrough
  const today = new Date(); today.setHours(0,0,0,0)
  const { data: signin } = await service.from("signins")
    .select("id")
    .eq("user_id", installer.userId)
    .eq("job_id", jobId)
    .gte("signed_in_at", today.toISOString())
    .order("signed_in_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: walkthrough, error: insertErr } = await service.from("job_walkthroughs").insert({
    job_id: jobId,
    user_id: installer.userId,
    company_id: me.company_id,
    signin_id: signin?.id || null,
    stage,
    video_url: videoUrl || null,
    stream_uid: streamUid || null,
    video_duration_seconds: videoDurationSeconds || null,
    lat: lat || null,
    lng: lng || null,
    upload_status: videoUrl ? "uploaded" : "pending",
  }).select().single()

  if (insertErr) {
    console.error("[walkthrough/upload] insert failed", insertErr)
    return NextResponse.json({ error: "Save failed", detail: insertErr.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, walkthrough })
}