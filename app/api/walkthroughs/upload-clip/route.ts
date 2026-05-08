import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { verifyInstallerToken } from "@/lib/auth"
import { GoogleGenerativeAI } from "@google/generative-ai"

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

export async function POST(request: Request) {
  const installer = verifyInstallerToken(request)
  if (!installer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const body = await request.json()
    const { jobId, streamUid, durationSeconds, lat, lng, playbackUrl } = body

    if (!jobId || !streamUid) {
      return NextResponse.json({ error: "Missing jobId or streamUid" }, { status: 400 })
    }

    const service = await createServiceClient()

    // Verify job belongs to installer's company
    const { data: me } = await service
      .from("users")
      .select("id, company_id, name")
      .eq("id", installer.userId)
      .single()
    if (!me?.company_id) return NextResponse.json({ error: "No company" }, { status: 400 })

    // Cap check: 5 walkthroughs/month per company
    const { data: company } = await service
      .from("companies")
      .select("voice_capture_count_month, voice_capture_count_reset_at, voice_capture_enabled")
      .eq("id", me.company_id)
      .single()

    // Reset counter if past reset date
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
        duration_seconds: durationSeconds || null,
        approval_status: "pending"
      })
      .select()
      .single()

    if (wErr || !walkthrough) {
      console.error("[walkthrough/upload-clip] walkthrough insert failed:", wErr?.message)
      return NextResponse.json({ error: "Failed to create walkthrough", detail: wErr?.message }, { status: 500 })
    }

    // Transcribe audio with Gemini directly from Stream URL
    let transcript = ""
    try {
      const streamUrl = playbackUrl || `https://customer-6416opuz33lyk78q.cloudflarestream.com/${streamUid}/manifest/video.m3u8`

      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" })
      const transcriptResult = await model.generateContent([
        {
          fileData: {
            mimeType: "video/mp4",
            fileUri: streamUrl
          }
        },
        "Transcribe the spoken narration in this video. Output only the transcript text — no preamble, no description, no formatting. Use British English."
      ])
      transcript = transcriptResult.response.text().trim()
      console.log("[walkthrough/upload-clip] transcript length:", transcript.length)
    } catch (e: any) {
      console.error("[walkthrough/upload-clip] transcription failed:", e.message)
      // Continue without transcript — AI processing will note it
    }

    // Create clip record
    const { error: cErr } = await service.from("walkthrough_clips").insert({
      walkthrough_id: walkthrough.id,
      sequence_number: 1,
      stream_video_id: streamUid,
      duration_seconds: durationSeconds || null,
      transcript: transcript || null
    })

    if (cErr) {
      console.error("[walkthrough/upload-clip] clip insert failed:", cErr.message)
      return NextResponse.json({ error: "Failed to save clip", detail: cErr.message }, { status: 500 })
    }

    // Trigger AI processing (fire and forget — client polls or just refreshes)
    try {
      const baseUrl = request.headers.get("x-forwarded-proto") + "://" + request.headers.get("host")
      fetch(baseUrl + "/api/walkthroughs/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walkthroughId: walkthrough.id })
      }).catch(e => console.error("[walkthrough/upload-clip] AI trigger failed:", e.message))
    } catch (e: any) {
      console.error("[walkthrough/upload-clip] AI trigger error:", e.message)
    }

    return NextResponse.json({
      success: true,
      walkthrough_id: walkthrough.id,
      transcript_preview: transcript.slice(0, 200)
    })
  } catch (e: any) {
    console.error("[walkthrough/upload-clip] unhandled:", e)
    return NextResponse.json({ error: e.message || "Unknown error" }, { status: 500 })
  }
}
