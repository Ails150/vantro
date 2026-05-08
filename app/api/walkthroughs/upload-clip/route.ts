import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { verifyInstallerToken } from "@/lib/auth"
import { GoogleGenerativeAI } from "@google/generative-ai"

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

export const maxDuration = 120  // Vercel: allow up to 2 min for stream encoding wait + Gemini

const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID
const CF_STREAM_TOKEN = process.env.CLOUDFLARE_STREAM_TOKEN

// Poll Cloudflare Stream until video is encoded and ready
async function waitForStreamReady(streamUid: string, maxWaitMs = 90000): Promise<{ ready: boolean; duration: number | null }> {
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
    await new Promise(r => setTimeout(r, 3000))
  }
  return { ready: false, duration: lastDuration }
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

    // Wait for Cloudflare to finish encoding the video
    console.log("[upload-clip] waiting for Cloudflare to encode...")
    const { ready, duration: cfDuration } = await waitForStreamReady(streamUid)
    console.log("[upload-clip] stream ready=", ready, "duration=", cfDuration)

    // Use Cloudflare's reported duration if mobile didn't send one
    const finalDuration = durationSeconds || cfDuration || null

    // Create walkthrough record
    const { data: walkthrough, error: wErr } = await service
      .from("walkthroughs")
      .insert({
        company_id: me.company_id,
        job_id: jobId,
        installer_id: installer.userId,
        recorded_at: new Date().toISOString(),
        gps_lat: lat || null,
        gps_lng: lng || null,
        duration_seconds: finalDuration,
        approval_status: "pending"
      })
      .select()
      .single()

    if (wErr || !walkthrough) {
      console.error("[upload-clip] walkthrough insert failed:", wErr?.message)
      return NextResponse.json({ error: "Failed to create walkthrough", detail: wErr?.message }, { status: 500 })
    }

    // Transcribe with Gemini using the MP4 download URL (more reliable than HLS for AI)
    let transcript = ""
    if (ready) {
      try {
        const downloadUrl = `https://customer-6416opuz33lyk78q.cloudflarestream.com/${streamUid}/downloads/default.mp4`
        const watchUrl = `https://customer-6416opuz33lyk78q.cloudflarestream.com/${streamUid}/manifest/video.m3u8`

        // Try MP4 first, fall back to HLS
        const fileUri = downloadUrl

        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" })
        const transcriptResult = await model.generateContent([
          {
            fileData: {
              mimeType: "video/mp4",
              fileUri
            }
          },
          "Transcribe the spoken narration in this video. Output only the transcript text. No preamble, no description, no formatting. Use British English. If there is no audible speech, return exactly the string: NO_AUDIBLE_SPEECH"
        ])
        transcript = transcriptResult.response.text().trim()
        console.log("[upload-clip] transcript length:", transcript.length, "preview:", transcript.slice(0, 100))

        if (transcript === "NO_AUDIBLE_SPEECH") {
          transcript = ""
        }
      } catch (e: any) {
        console.error("[upload-clip] transcription failed:", e.message)
      }
    } else {
      console.warn("[upload-clip] stream did not become ready in time, skipping transcription")
    }

    // Create clip record
    const { error: cErr } = await service.from("walkthrough_clips").insert({
      walkthrough_id: walkthrough.id,
      sequence_number: 1,
      stream_video_id: streamUid,
      duration_seconds: finalDuration,
      transcript: transcript || null
    })

    if (cErr) {
      console.error("[upload-clip] clip insert failed:", cErr.message)
      return NextResponse.json({ error: "Failed to save clip", detail: cErr.message }, { status: 500 })
    }

    // Trigger AI structuring (synchronous so client knows result)
    try {
      const baseUrl = request.headers.get("x-forwarded-proto") + "://" + request.headers.get("host")
      const procRes = await fetch(baseUrl + "/api/walkthroughs/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walkthroughId: walkthrough.id })
      })
      const procData = await procRes.json()
      console.log("[upload-clip] AI processing result:", procData.success)
    } catch (e: any) {
      console.error("[upload-clip] AI trigger error:", e.message)
    }

    return NextResponse.json({
      success: true,
      walkthrough_id: walkthrough.id,
      transcript_preview: transcript.slice(0, 200),
      stream_ready: ready,
      duration: finalDuration
    })
  } catch (e: any) {
    console.error("[upload-clip] unhandled:", e)
    return NextResponse.json({ error: e.message || "Unknown error" }, { status: 500 })
  }
}
