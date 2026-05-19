import { NextRequest, NextResponse } from "next/server"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { createServiceClient } from "@/lib/supabase/server"
import { WALKTHROUGH_SYSTEM_PROMPT, buildUserMessage } from "@/lib/ai/walkthrough-prompt"
import { verifyInstallerToken } from "@/lib/auth"
import { checkRateLimit } from "@/lib/rate-limit"

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

export async function POST(req: NextRequest) {
  // audit-guard-2026-05-19 - security hardening pass
  let _installer
  try {
    _installer = await verifyInstallerToken(req)
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!_installer) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  {
    const _ok = await checkRateLimit(`walkthroughs-process:user:${_installer.userId}`, 10, 3600)
    if (!_ok) {
      return NextResponse.json({ error: "Too many requests. Slow down." }, { status: 429 })
    }
  }

  try {
    const { walkthroughId } = await req.json()
    if (!walkthroughId) {
      return NextResponse.json({ error: "walkthroughId required" }, { status: 400 })
    }

    const service = await createServiceClient()

    const { data: walkthrough, error: fetchErr } = await service
      .from("walkthroughs")
      .select(`
        *,
        job:jobs(address, name, required_trades),
        installer:users!installer_id(name),
        clips:walkthrough_clips(sequence_number, duration_seconds, transcript)
      `)
      .eq("id", walkthroughId)
      .single()

    if (fetchErr || !walkthrough) {
      return NextResponse.json({ error: "Walkthrough not found", detail: fetchErr?.message }, { status: 404 })
    }

    const sortedClips = (walkthrough.clips || [])
      .sort((a: any, b: any) => a.sequence_number - b.sequence_number)

    if (sortedClips.length === 0) {
      return NextResponse.json({ error: "No clips found for this walkthrough" }, { status: 400 })
    }

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

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: WALKTHROUGH_SYSTEM_PROMPT,
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.3,
      },
    })

    const result = await model.generateContent(userMessage)
    const responseText = result.response.text()

    let parsed: any
    try {
      parsed = JSON.parse(responseText)
    } catch (e) {
      console.error("[walkthrough/process] Gemini returned invalid JSON:", responseText)
      return NextResponse.json({ error: "AI returned invalid JSON", raw: responseText }, { status: 500 })
    }

    const fullTranscript = sortedClips
      .map((c: any) => c.transcript)
      .filter(Boolean)
      .join(" ")

    const { error: updateErr } = await service
      .from("walkthroughs")
      .update({
        transcript_full: fullTranscript,
        ai_summary: parsed.summary ?? null,
        ai_sections: parsed.sections ?? [],
        ai_themes: parsed.themes ?? [],
        ai_sentiment: parsed.sentiment ?? "neutral",
        ai_flags: parsed.flags ?? [],
      })
      .eq("id", walkthroughId)

    if (updateErr) {
      console.error("[walkthrough/process] Update failed:", updateErr.message)
      return NextResponse.json({ error: updateErr.message }, { status: 500 })
    }

    await service.rpc("increment_voice_capture_count", {
      p_company_id: walkthrough.company_id,
    })

    return NextResponse.json({
      success: true,
      walkthrough_id: walkthroughId,
      ai: parsed,
    })
  } catch (e: any) {
    console.error("[walkthrough/process] Unhandled error:", e)
    return NextResponse.json({ error: e.message ?? "Unknown error" }, { status: 500 })
  }
}
