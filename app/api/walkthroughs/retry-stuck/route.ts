import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { processWalkthrough } from "../upload-clip/route"

export const maxDuration = 300

// Cron-triggered: catches walkthroughs that got stuck (Vercel killed function, network dropout, etc)
export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const service = await createServiceClient()

  // Find walkthroughs stuck in "processing" for >5 min, or "pending" never picked up
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()

  const { data: stuck, error } = await service
    .from("walkthroughs")
    .select(`
      id,
      processing_status,
      processing_started_at,
      processing_attempts,
      created_at,
      clips:walkthrough_clips(stream_video_id)
    `)
    .or(`and(processing_status.eq.processing,processing_started_at.lt.${fiveMinAgo}),and(processing_status.eq.pending,created_at.lt.${tenMinAgo})`)
    .lt("processing_attempts", 5)
    .limit(20)

  if (error) {
    console.error("[retry-stuck] query failed:", error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  console.log(`[retry-stuck] found ${stuck?.length || 0} stuck walkthroughs`)

  const results: any[] = []
  for (const w of stuck || []) {
    const streamUid = w.clips?.[0]?.stream_video_id
    if (!streamUid) {
      console.warn(`[retry-stuck] ${w.id} has no stream_video_id, marking failed`)
      await service
        .from("walkthroughs")
        .update({
          processing_status: "failed",
          processing_error: "No stream_video_id on associated clip",
          processing_completed_at: new Date().toISOString()
        })
        .eq("id", w.id)
      results.push({ id: w.id, status: "marked_failed_no_clip" })
      continue
    }

    console.log(`[retry-stuck] retrying ${w.id} (attempt ${(w.processing_attempts || 0) + 1})`)

    // Run synchronously inside the cron — we have 5 min to work with
    try {
      await processWalkthrough(w.id, streamUid)
      results.push({ id: w.id, status: "retried" })
    } catch (e: any) {
      console.error(`[retry-stuck] ${w.id} failed:`, e.message)
      results.push({ id: w.id, status: "failed", error: e.message })
    }
  }

  return NextResponse.json({
    found: stuck?.length || 0,
    processed: results.length,
    results
  })
}
