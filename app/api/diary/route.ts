import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import { verifyInstallerToken } from "@/lib/auth"
import Anthropic from "@anthropic-ai/sdk"


const createServiceClient = () => {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  )
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

const severityRank: Record<string, number> = { normal: 1, issue: 2, blocker: 3 }

export async function POST(request: Request) {
  try {
    const { entryText, workStatus, jobId, lat, lng, photoUrls, videoUrl } = await request.json()
    if (!entryText?.trim() && (!photoUrls || photoUrls.length === 0) && !videoUrl) {
      return NextResponse.json({ error: "Entry requires text, photo, or video" }, { status: 400 })
    }

    const trimmedText = (entryText || "").trim().toLowerCase()
    const claimsVideo =
      trimmedText === "video entry" ||
      trimmedText.startsWith("\ud83c\udfa5") ||
      trimmedText.includes("video entry")
    if (claimsVideo && !videoUrl) {
      console.error("[diary] Rejected: claims video but videoUrl missing", { entryText, jobId })
      return NextResponse.json(
        { error: "Video upload did not complete. Please try again from the app." },
        { status: 400 }
      )
    }

    const installer = verifyInstallerToken(request)
    if (!installer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const payload = { userId: installer.userId, companyId: installer.companyId }

    const service = createServiceClient()

    const { data: diary, error: diaryError } = await service
      .from("diary_entries")
      .insert({
        user_id: payload.userId,
        company_id: payload.companyId,
        job_id: jobId,
        entry_text: entryText || '',
        photo_urls: photoUrls || [],
        video_url: videoUrl || null,
        lat,
        lng,
        created_at: new Date().toISOString()
      })
      .select()
      .single()

    if (diaryError) throw diaryError

    // Build multimodal prompt: text + up to 5 photos + video flag.
    const safePhotos: string[] = Array.isArray(photoUrls) ? photoUrls.slice(0, 5) : []

    const userContent: any[] = []
    userContent.push({
      type: "text",
      text: `An installer has just submitted a diary entry on a construction site.

Their text: ${entryText || "(no text)"}
Photos attached: ${safePhotos.length}
Video attached: ${videoUrl ? "yes" : "no"}

Look at everything they sent (text and any photos below). Decide if this is:
- "blocker": work has stopped or cannot continue. Examples: no materials, site unsafe, access denied, equipment failure, injury, flooding, structural damage, key trade did not finish, can't proceed.
- "issue": a problem that may slow things or needs attention. Examples: delay, defect, missing item, weather concern, partial supply, snag, complaint.
- "normal": routine progress update with nothing wrong.

Be strict. If a foreman would want to know about it, it is at minimum "issue". Photos can change the verdict on their own — a photo of a flooded floor or unfinished work is a blocker even if the text is bland.

Return ONLY valid JSON, no preamble, no markdown:
{"summary":"<one sentence under 20 words>","severity":"normal|issue|blocker","reason":"<one short sentence why>"}`
    })

    for (const url of safePhotos) {
      if (typeof url === "string" && url.startsWith("http")) {
        userContent.push({
          type: "image",
          source: { type: "url", url }
        })
      }
    }

    let aiSummary = (entryText || "").slice(0, 80) || "Diary entry"
    let aiSeverity: "normal" | "issue" | "blocker" = "normal"
    let aiReason = ""

    try {
      const completion = await anthropic.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 400,
        messages: [{ role: "user", content: userContent }]
      })

      const raw = completion.content[0].type === "text" ? completion.content[0].text.trim() : ""
      const cleaned = raw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim()
      const parsed = JSON.parse(cleaned)

      if (parsed.summary) aiSummary = String(parsed.summary).trim().replace(/^["']|["']$/g, "")
      if (parsed.severity && ["normal", "issue", "blocker"].includes(parsed.severity)) {
        aiSeverity = parsed.severity
      }
      if (parsed.reason) aiReason = String(parsed.reason).trim()
    } catch (aiErr) {
      console.error("[diary] AI classify failed, falling back to tap-only:", aiErr)
    }

    // Video pending review safety net: if video uploaded but we have no analysis yet, raise to issue.
    if (videoUrl && severityRank[aiSeverity] < severityRank["issue"]) {
      aiSeverity = "issue"
      if (!aiReason) aiReason = "Video pending review"
    }

    // Tap-based severity from installer's button choice.
    const statusToAlert: Record<string, string> = {
      carrying_on: "normal",
      paused: "issue",
      stopped: "blocker"
    }
    const tapSeverity = statusToAlert[workStatus || "carrying_on"] || "normal"

    // Take the MORE SEVERE of tap and AI.
    const finalSeverity =
      severityRank[aiSeverity] > severityRank[tapSeverity] ? aiSeverity : tapSeverity

    const urgency = finalSeverity === "blocker" ? 5 : finalSeverity === "issue" ? 3 : 1
    console.log("[diary] tap=", tapSeverity, "ai=", aiSeverity, "final=", finalSeverity, "reason=", aiReason)

    await service
      .from("diary_entries")
      .update({
        ai_alert_type: finalSeverity,
        ai_summary: aiSummary,
        urgency
      })
      .eq("id", diary.id)

    if (finalSeverity === "blocker" || finalSeverity === "issue") {
      const { error: alertError } = await service
        .from("alerts")
        .insert({
          company_id: payload.companyId,
          job_id: jobId,
          user_id: payload.userId,
          alert_type: finalSeverity,
          message: aiSummary || (entryText || "").slice(0, 100),
          diary_entry_id: diary.id,
          status: "open",
          urgency,
          is_read: false,
          created_at: new Date().toISOString()
        })
      if (alertError) {
        console.error("[diary] Alert insert failed:", alertError)
      } else {
        console.log("[diary] Alert created:", finalSeverity, "for diary", diary.id)
      }
    }

    return NextResponse.json({ success: true, severity: finalSeverity, summary: aiSummary })

  } catch (error) {
    console.error("Diary route error:", error)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}

export async function GET(request: Request) {
  try {
    const installer = verifyInstallerToken(request)
    if (!installer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const jobId = searchParams.get("jobId")
    if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 })

    const service = createServiceClient()

    const { data: entries, error } = await service
      .from("diary_entries")
      .select("*")
      .eq("company_id", installer.companyId)
      .eq("job_id", jobId)
      .order("created_at", { ascending: true })

    if (error) {
      console.error("Diary GET error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ entries: entries || [] })
  } catch (e: any) {
    console.error("Diary GET exception:", e)
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 })
  }
}