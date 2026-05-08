import { NextResponse } from "next/server"
import { waitUntil } from "@vercel/functions"
import { createServiceClient } from "@/lib/supabase/server"
import { verifyInstallerToken } from "@/lib/auth"
import { GoogleGenerativeAI } from "@google/generative-ai"

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID
const CF_STREAM_TOKEN = process.env.CLOUDFLARE_STREAM_TOKEN

export const maxDuration = 300

// Poll Cloudflare Stream until video is encoded and ready
async function waitForStreamReady(streamUid: string, maxWaitMs = 180000): Promise<{ ready: boolean; duration: number | null }> {
  const start = Date.now()
  let lastDuration: number | null = null

  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream/${streamUid}`,
        { headers: { Authorization: `Bearer ${CF_STREAM_TOKEN}` } }
      )
      const data = await res.json()
      if (data?.result) {
        lastDuration = data.result.duration ?? lastDuration
        if (data.result.readyToStream === true) {
          return { ready: true, duration: lastDuration }
        }
      }
    } catch (e: any) {
      console.error("[upload-clip] poll error:", e.message)
    }
    await new Promise(r => setTimeout(r, 4000))
  }
  return { ready: false, duration: lastDuration }
}

// The actual processing pipeline. Idempotent — safe to retry.
export async function processWalkthrough(walkthroughId: string, streamUid: string) {
  const service = await createServiceClient()

  console.log(`[process ${walkthroughId}] starting`)

  // Mark as processing + bump attempt counter
  await service
    .from("walkthroughs")
    .update({
      processing_status: "processing",
      processing_started_at: new Date().toISOString(),
      processing_error: null
    })
    .eq("id", walkthroughId)

  // Bump attempt counter (direct increment — no RPC needed)
  try {
    const { data: prev } = await service
      .from("walkthroughs")
      .select("processing_attempts")
      .eq("id", walkthroughId)
      .single()
    if (prev) {
      await service
        .from("walkthroughs")
        .update({ processing_attempts: (prev.processing_attempts || 0) + 1 })
        .eq("id", walkthroughId)
    }
  } catch (e: any) {
    console.warn(`[process ${walkthroughId}] attempt counter bump failed:`, e?.message)
  }

  try {
    // 1. Wait for Cloudflare to encode
    console.log(`[process ${walkthroughId}] waiting for Cloudflare encoding`)
    const { ready, duration: cfDuration } = await waitForStreamReady(streamUid)
    if (!ready) {
      throw new Error("Cloudflare did not finish encoding within timeout")
    }
    console.log(`[process ${walkthroughId}] stream ready, duration=${cfDuration}`)

    // 2. Update duration if Cloudflare gave us a value
    if (cfDuration) {
      await service
        .from("walkthroughs")
        .update({ duration_seconds: cfDuration })
        .eq("id", walkthroughId)

      await service
        .from("walkthrough_clips")
        .update({ duration_seconds: cfDuration })
        .eq("walkthrough_id", walkthroughId)
    }

    // 3. Transcribe with Gemini
    console.log(`[process ${walkthroughId}] transcribing`)
    const downloadUrl = `https://customer-6416opuz33lyk78q.cloudflarestream.com/${streamUid}/downloads/default.mp4`

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" })
    const transcriptResult = await model.generateContent([
      {
        fileData: {
          mimeType: "video/mp4",
          fileUri: downloadUrl
        }
      },
      "Transcribe the spoken narration in this video. Output only the transcript text. No preamble, no description, no formatting. Use British English. If there is no audible speech, return exactly: NO_AUDIBLE_SPEECH"
    ])
    let transcript = transcriptResult.response.text().trim()
    if (transcript === "NO_AUDIBLE_SPEECH") transcript = ""

    console.log(`[process ${walkthroughId}] transcript length=${transcript.length}`)

    // 4. Save transcript to clip
    await service
      .from("walkthrough_clips")
      .update({ transcript: transcript || null })
      .eq("walkthrough_id", walkthroughId)

    // 5. Trigger AI structuring
    console.log(`[process ${walkthroughId}] structuring with AI`)
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "https://app.getvantro.com"

    const procRes = await fetch(`${baseUrl}/api/walkthroughs/process`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walkthroughId })
    })

    if (!procRes.ok) {
      const errText = await procRes.text()
      throw new Error(`AI structuring failed: ${errText}`)
    }

    // 6. Mark as ready
    await service
      .from("walkthroughs")
      .update({
        processing_status: "ready",
        processing_completed_at: new Date().toISOString(),
        processing_error: null
      })
      .eq("id", walkthroughId)

    console.log(`[process ${walkthroughId}] DONE`)
  } catch (e: any) {
    console.error(`[process ${walkthroughId}] FAILED:`, e.message)

    // Get current attempt count
    const { data: w } = await service
      .from("walkthroughs")
      .select("processing_attempts")
      .eq("id", walkthroughId)
      .single()

    const attempts = w?.processing_attempts || 0
    const nextStatus = attempts >= 5 ? "failed" : "pending"

    await service
      .from("walkthroughs")
      .update({
        processing_status: nextStatus,
        processing_error: e.message,
        processing_completed_at: nextStatus === "failed" ? new Date().toISOString() : null
      })
      .eq("id", walkthroughId)
  }
}

export async function POST(request: Request) {
  const installer = verifyInstallerToken(request)
  if (!installer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const body = await request.json()
    const { jobId, streamUid, durationSeconds, lat, lng } = body

    if (!jobId || !streamUid) {
      return NextResponse.json({ error: "Missing jobId or streamUid" }, { status: 400 })
    }

    const service = await createServiceClient()

    const { data: me } = await service
      .from("users")
      .select("id, company_id, name")
      .eq("id", installer.userId)
      .single()
    if (!me?.company_id) return NextResponse.json({ error: "No company" }, { status: 400 })

    // Cap check
    const { data: company } = await service
      .from("companies")
      .select("voice_capture_count_month, voice_capture_count_reset_at")
      .eq("id", me.company_id)
      .single()

    if (company?.voice_capture_count_reset_at && new Date(company.voice_capture_count_reset_at) < new Date()) {
      await service
        .from("companies")
        .update({
          voice_capture_count_month: 0,
          voice_capture_count_reset_at: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString()
        })
        .eq("id", me.company_id)
    }

    if ((company?.voice_capture_count_month || 0) >= 5) {
      return NextResponse.json({
        error: "Monthly limit reached",
        message: "You have used your 5 voice walkthroughs for this month. They reset on the 1st.",
        capReached: true
      }, { status: 429 })
    }

    // Create walkthrough + clip rows IMMEDIATELY (so nothing is lost)
    const { data: walkthrough, error: wErr } = await service
      .from("walkthroughs")
      .insert({
        company_id: me.company_id,
        job_id: jobId,
        installer_id: installer.userId,
        recorded_at: new Date().toISOString(),
        gps_lat: lat || null,
        gps_lng: lng || null,
        duration_seconds: durationSeconds || null,
        approval_status: "pending",
        processing_status: "pending"
      })
      .select()
      .single()

    if (wErr || !walkthrough) {
      console.error("[upload-clip] walkthrough insert failed:", wErr?.message)
      return NextResponse.json({ error: "Failed to create walkthrough", detail: wErr?.message }, { status: 500 })
    }

    const { error: cErr } = await service.from("walkthrough_clips").insert({
      walkthrough_id: walkthrough.id,
      sequence_number: 1,
      stream_video_id: streamUid,
      duration_seconds: durationSeconds || null,
      transcript: null
    })

    if (cErr) {
      console.error("[upload-clip] clip insert failed:", cErr.message)
      return NextResponse.json({ error: "Failed to save clip", detail: cErr.message }, { status: 500 })
    }

    // FIRE BACKGROUND PROCESSING — function stays alive after response
    waitUntil(processWalkthrough(walkthrough.id, streamUid))

    // RETURN IMMEDIATELY — installer never waits
    return NextResponse.json({
      success: true,
      walkthrough_id: walkthrough.id,
      processing_status: "processing",
      message: "Walk & Talk saved. AI analysis is running in the background."
    })
  } catch (e: any) {
    console.error("[upload-clip] unhandled:", e)
    return NextResponse.json({ error: e.message || "Unknown error" }, { status: 500 })
  }
}
