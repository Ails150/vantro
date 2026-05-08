import { NextResponse } from "next/server"
import { waitUntil } from "@vercel/functions"
import { createServiceClient } from "@/lib/supabase/server"
import { verifyInstallerToken } from "@/lib/auth"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { WALKTHROUGH_SYSTEM_PROMPT, buildUserMessage } from "@/lib/ai/walkthrough-prompt"

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID
const CF_STREAM_TOKEN = process.env.CLOUDFLARE_STREAM_TOKEN

export const maxDuration = 300

// Enable MP4 download on a Cloudflare Stream video
async function enableMp4Download(streamUid: string): Promise<void> {
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream/${streamUid}/downloads`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${CF_STREAM_TOKEN}` }
      }
    )
    const data = await res.json()
    console.log(`[upload-clip] enableMp4Download response:`, JSON.stringify(data).slice(0, 200))
  } catch (e: any) {
    console.warn("[upload-clip] enableMp4Download failed:", e.message)
  }
}

// Poll Cloudflare until BOTH the stream is ready AND the MP4 download is available
async function waitForStreamReady(streamUid: string, maxWaitMs = 240000): Promise<{ ready: boolean; duration: number | null; mp4Url: string | null }> {
  const start = Date.now()
  let lastDuration: number | null = null
  let mp4Enabled = false

  while (Date.now() - start < maxWaitMs) {
    try {
      // Step 1: Check stream status
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream/${streamUid}`,
        { headers: { Authorization: `Bearer ${CF_STREAM_TOKEN}` } }
      )
      const data = await res.json()
      if (data?.result) {
        lastDuration = data.result.duration ?? lastDuration

        // Once stream is ready, request MP4 download enablement (idempotent)
        if (data.result.readyToStream === true && !mp4Enabled) {
          await enableMp4Download(streamUid)
          mp4Enabled = true
        }

        // Step 2: If stream is ready, check the MP4 download
        if (data.result.readyToStream === true) {
          const mp4Res = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream/${streamUid}/downloads`,
            { headers: { Authorization: `Bearer ${CF_STREAM_TOKEN}` } }
          )
          const mp4Data = await mp4Res.json()
          const mp4Status = mp4Data?.result?.default?.status
          const mp4Url = mp4Data?.result?.default?.url
          console.log(`[upload-clip] mp4 status=${mp4Status}, url=${mp4Url ? "present" : "missing"}`)

          if (mp4Status === "ready" && mp4Url) {
            return { ready: true, duration: lastDuration, mp4Url }
          }
        }
      }
    } catch (e: any) {
      console.error("[upload-clip] poll error:", e.message)
    }
    await new Promise(r => setTimeout(r, 5000))
  }
  return { ready: false, duration: lastDuration, mp4Url: null }
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
    // 1. Wait for Cloudflare to encode (HLS + MP4 download)
    console.log(`[process ${walkthroughId}] waiting for Cloudflare encoding + MP4`)
    const { ready, duration: cfDuration, mp4Url } = await waitForStreamReady(streamUid)
    if (!ready || !mp4Url) {
      throw new Error("Cloudflare did not finish encoding (or MP4 not ready) within timeout")
    }
    console.log(`[process ${walkthroughId}] stream ready, duration=${cfDuration}, mp4=${mp4Url}`)

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

    // 3. Transcribe with Gemini using the verified MP4 URL
    console.log(`[process ${walkthroughId}] transcribing from ${mp4Url}`)

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" })
    const transcriptResult = await model.generateContent([
      {
        fileData: {
          mimeType: "video/mp4",
          fileUri: mp4Url
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

    // 5. Inline AI structuring (no HTTP self-call)
    console.log(`[process ${walkthroughId}] structuring with AI`)

    const { data: walkthrough } = await service
      .from("walkthroughs")
      .select(`
        *,
        job:jobs(address, name, required_trades),
        installer:users!installer_id(name),
        clips:walkthrough_clips(sequence_number, duration_seconds, transcript)
      `)
      .eq("id", walkthroughId)
      .single()

    if (!walkthrough) throw new Error("Walkthrough vanished mid-process")

    const sortedClips = (walkthrough.clips || []).sort((a: any, b: any) => a.sequence_number - b.sequence_number)
    if (sortedClips.length === 0) throw new Error("No clips found for structuring")

    const tradeType = Array.isArray(walkthrough.job?.required_trades) && walkthrough.job.required_trades.length > 0
      ? walkthrough.job.required_trades.join(", ")
      : "general"

    const userMessage = buildUserMessage({
      jobAddress: walkthrough.job?.address ?? walkthrough.job?.name ?? "Unknown site",
      tradeType,
      installerName: walkthrough.installer?.name ?? "Installer",
      recordedAt: walkthrough.recorded_at,
      clips: sortedClips.map((c: any) => ({
        sequence: c.sequence_number,
        durationSeconds: c.duration_seconds ?? 0,
        transcript: c.transcript ?? "",
      })),
    })

    const structureModel = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: WALKTHROUGH_SYSTEM_PROMPT,
      generationConfig: { responseMimeType: "application/json", temperature: 0.3 },
    })

    const structureResult = await structureModel.generateContent(userMessage)
    const responseText = structureResult.response.text()

    let parsed: any
    try {
      parsed = JSON.parse(responseText)
    } catch (e) {
      throw new Error(`AI returned invalid JSON: ${responseText.slice(0, 200)}`)
    }

    const fullTranscript = sortedClips.map((c: any) => c.transcript).filter(Boolean).join(" ")

    // 6. Save structured AI output + mark ready
    const { error: updateErr } = await service
      .from("walkthroughs")
      .update({
        transcript_full: fullTranscript,
        ai_summary: parsed.summary ?? null,
        ai_sections: parsed.sections ?? [],
        ai_themes: parsed.themes ?? [],
        ai_sentiment: parsed.sentiment ?? "neutral",
        ai_flags: parsed.flags ?? [],
        processing_status: "ready",
        processing_completed_at: new Date().toISOString(),
        processing_error: null
      })
      .eq("id", walkthroughId)

    if (updateErr) throw new Error(`Failed to save AI output: ${updateErr.message}`)

    // 7. Increment voice capture count for billing
    try {
      await service.rpc("increment_voice_capture_count", { p_company_id: walkthrough.company_id })
    } catch (e: any) {
      console.warn(`[process ${walkthroughId}] count increment failed:`, e?.message)
    }

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
