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
    if (!entryText?.trim()) {
      return NextResponse.json({ error: "Please add a note describing what is happening on site" }, { status: 400 })
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

ALSO decide separately: is this entry describing a VARIATION? A variation is work outside the original contracted scope, typically requested by the client during the job, that should be priced separately and invoiced. Strong variation signals: "client asked", "they want", "they decided", "swap to", "instead of", "additional", "extra", "on top of", "not in spec", "not on drawings", "upgrade to", client name + "requested". Negative signals (NOT variations even if language overlaps): defect rectification, snagging, internal team coordination, missing materials being chased, weather delays.

Be strict on variations. Only flag if the language clearly indicates client-requested scope change.

Photos can change the verdict on their own — a photo of a flooded floor or unfinished work is a blocker even if the text is bland.

Return ONLY valid JSON, no preamble, no markdown:
{"summary":"<one sentence under 20 words>","severity":"normal|issue|blocker","reason":"<one short sentence why>","is_variation":<true|false>,"variation_confidence":"<high|medium|low|null>","variation_summary":"<brief description of what changed, or null>"}`
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
    let aiVariationDetected = false
    let aiVariationConfidence: "high" | "medium" | "low" | null = null
    let aiVariationSummary: string | null = null

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

      // Variation detection
      if (parsed.is_variation === true) {
        aiVariationDetected = true
        aiVariationConfidence = ["high","medium","low"].includes(parsed.variation_confidence) ? parsed.variation_confidence : "low"
        aiVariationSummary = parsed.variation_summary ? String(parsed.variation_summary).trim().slice(0, 300) : aiSummary
      }
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
        urgency,
        ai_variation_detected: aiVariationDetected
      })
      .eq("id", diary.id)

    // If variation detected, create a row in variations register
    if (aiVariationDetected) {
      const { error: varError } = await service
        .from("variations")
        .insert({
          company_id: payload.companyId,
          job_id: jobId,
          diary_entry_id: diary.id,
          raised_by: payload.userId,
          description: aiVariationSummary || aiSummary,
          ai_detected: true,
          ai_confidence: aiVariationConfidence,
          status: "pending"
        })
      if (varError) {
        console.error("[diary] variation insert failed (non-fatal):", varError.message)
      } else {
        console.log("[diary] variation auto-created for diary", diary.id, "confidence:", aiVariationConfidence)
      }
    }

    if (finalSeverity === "blocker" || finalSeverity === "issue") {
      const { error: alertError } = await service
        .from("alerts")
        .insert({
          company_id: payload.companyId,
          job_id: jobId,
          user_id: payload.userId,
          alert_type: finalSeverity,
          message: (entryText && entryText.trim()) ? entryText.trim().slice(0, 200) : (aiSummary || "Diary entry"),
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
        // Push admin/foreman for new blocker or issue alerts
        try {
          const { data: jobInfo } = await service.from("jobs").select("name").eq("id", jobId).single()
          const { data: installerInfo } = await service.from("users").select("name").eq("id", payload.userId).single()
          const { data: admins } = await service.from("users")
            .select("push_token")
            .eq("company_id", payload.companyId)
            .in("role", ["admin", "foreman"])
          const adminTokens = (admins || []).map((a: any) => a.push_token).filter(Boolean)
          if (adminTokens.length > 0) {
            await fetch("https://exp.host/--/api/v2/push/send", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Accept": "application/json" },
              body: JSON.stringify(adminTokens.map((t: string) => ({
                to: t,
                sound: "default",
                title: finalSeverity === "blocker" ? "BLOCKER reported" : "Site issue reported",
                body: (installerInfo?.name || "Installer") + " at " + (jobInfo?.name || "site") + ": " + (aiSummary || "").slice(0, 100),
                data: { type: "diary_alert", diaryId: diary.id, jobId, severity: finalSeverity },
                channelId: "vantro",
              }))),
            }).catch(() => {})
            console.log("[diary] Pushed", adminTokens.length, "admin/foreman tokens for", finalSeverity)
          }
        } catch (pushErr) {
          console.error("[diary] push to admins failed (non-fatal):", pushErr)
        }
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

    // Pagination: ?since=ISO_DATE limits to entries created on/after that time
    // ?limit=N caps results (default 50, max 200)
    const since = searchParams.get("since")
    const limitParam = parseInt(searchParams.get("limit") || "50", 10)
    const limit = Math.min(Math.max(limitParam, 1), 200)

    const service = createServiceClient()

    // 1. Fetch normal diary entries
    let query = service
      .from("diary_entries")
      .select("*")
      .eq("company_id", installer.companyId)
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(limit)

    if (since) {
      query = query.gte("created_at", since)
    }

    const { data: entries, error } = await query

    if (error) {
      console.error("Diary GET error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // 2. Fetch walk & talks in the same window — merge into the feed
    let walkQuery = service
      .from("walkthroughs")
      .select(`
        id,
        job_id,
        installer_id,
        recorded_at,
        created_at,
        ai_summary,
        ai_themes,
        ai_sentiment,
        ai_flags,
        approval_status,
        processing_status,
        duration_seconds,
        clips:walkthrough_clips(stream_video_id, transcript, sequence_number, duration_seconds)
      `)
      .eq("company_id", installer.companyId)
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(limit)

    if (since) {
      walkQuery = walkQuery.gte("created_at", since)
    }

    const { data: walkthroughs } = await walkQuery

    // 3. Map walkthroughs into diary-entry-shaped objects
    const sentimentToAlert = (s: string | null): string => {
      if (!s) return "none"
      const lower = s.toLowerCase()
      if (lower === "defect" || lower === "negative" || lower === "blocker") return "blocker"
      if (lower === "concern" || lower === "warning" || lower === "issue") return "issue"
      return "none"
    }

    const walkAsEntries = (walkthroughs || []).map((w: any) => {
      const clips = (w.clips || []).sort((a: any, b: any) => a.sequence_number - b.sequence_number)
      const summary = w.ai_summary || "Walk & Talk recorded — analysis in progress."
      return {
        id: `wt_${w.id}`,
        kind: "walktalk",
        walkthrough_id: w.id,
        job_id: w.job_id,
        user_id: w.installer_id,
        created_at: w.created_at,
        entry_text: summary,
        ai_summary: summary,
        ai_alert_type: sentimentToAlert(w.ai_sentiment),
        ai_themes: w.ai_themes || [],
        ai_sentiment: w.ai_sentiment,
        approval_status: w.approval_status,
        processing_status: w.processing_status,
        duration_seconds: w.duration_seconds,
        clips: clips.map((c: any) => ({
          stream_video_id: c.stream_video_id,
          transcript: c.transcript,
          sequence_number: c.sequence_number,
          duration_seconds: c.duration_seconds,
        })),
        photo_urls: [],
      }
    })

    // 4. Merge + sort chronologically (newest first), then reverse for display
    const merged = [...(entries || []), ...walkAsEntries]
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit)

    const sorted = merged.slice().reverse()

    return NextResponse.json({
      entries: sorted,
      hasMore: (entries?.length || 0) === limit,
      limit,
      since: since || null,
    })
  } catch (e: any) {
    console.error("Diary GET exception:", e)
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 })
  }
}