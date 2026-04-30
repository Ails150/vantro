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

export async function POST(request: Request) {
  try {
    const { entryText, workStatus, jobId, lat, lng, photoUrls, videoUrl } = await request.json()
    if (!entryText?.trim() && (!photoUrls || photoUrls.length === 0) && !videoUrl) return NextResponse.json({ error: "Entry requires text, photo, or video" }, { status: 400 })

    // Guard: reject entries that claim to be video uploads but have no video URL.
    // This catches buggy clients that insert a row before the Cloudflare upload finishes.
    // Avoids "Video entry" rows with video_url = NULL polluting the audit pack.
    const trimmedText = (entryText || "").trim().toLowerCase()
    const claimsVideo =
      trimmedText === "video entry" ||
      trimmedText.startsWith("\ud83c\udfa5") ||  // 🎥 emoji
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

    const completion = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [{
        role: "user",
        content: `Write a one-sentence summary of this construction site diary entry for the foreman. Plain language, no jargon, under 20 words. Just the facts.

Entry: ${entryText}

Respond with the summary sentence only, no JSON, no preamble.`
      }]
    })

    const aiSummary = completion.content[0].type === "text"
      ? completion.content[0].text.trim().replace(/^["']|["']$/g, "")
      : entryText.slice(0, 80)

    // Installer-driven classification. AI only writes the summary.
    const statusToAlert: Record<string, string> = {
      carrying_on: "normal",
      paused: "issue",
      stopped: "blocker"
    }
    const aiAlertType = statusToAlert[workStatus || "carrying_on"] || "normal"
    const urgency = aiAlertType === "blocker" ? 5 : aiAlertType === "issue" ? 3 : 1
    console.log("[diary] Classified by installer tap:", workStatus, "->", aiAlertType)

    await service
      .from("diary_entries")
      .update({
        ai_alert_type: aiAlertType,
        ai_summary: aiSummary,
        urgency
      })
      .eq("id", diary.id)

    if (aiAlertType === "blocker" || aiAlertType === "issue") {
      await service
        .from("alerts")
        .insert({
          company_id: payload.companyId,
          job_id: jobId,
          user_id: payload.userId,
          type: aiAlertType,
          message: aiSummary || entryText.slice(0, 100),
          diary_entry_id: diary.id,
          status: "open",
          urgency,
          created_at: new Date().toISOString()
        })
    }

    return NextResponse.json({ success: true })

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
