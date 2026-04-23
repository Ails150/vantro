import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
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
    const { entryText, jobId, lat, lng } = await request.json()
    if (!entryText?.trim()) return NextResponse.json({ error: "Entry text required" }, { status: 400 })

    const authHeader = request.headers.get("authorization")
    if (!authHeader?.startsWith("Bearer ")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    
    const token = authHeader.substring(7)
    let payload
    try {
      payload = JSON.parse(Buffer.from(token, "base64").toString())
    } catch {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 })
    }
    
    if (!payload.userId || !payload.companyId || Date.now() > payload.exp) {
      return NextResponse.json({ error: "Token expired" }, { status: 401 })
    }

    const service = createServiceClient()
    
    const { data: diary, error: diaryError } = await service
      .from("diary_entries")
      .insert({
        user_id: payload.userId,
        company_id: payload.companyId,
        job_id: jobId,
        entry_text: entryText,
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
        content: `Analyze this diary entry and classify it. Reply with JSON only: {"alert_type": "blocker|issue|normal", "summary": "brief summary", "urgency": 1-5}

Entry: ${entryText}`
      }]
    })

    const raw = completion.content[0].type === "text" ? completion.content[0].text : "{}"
    let parsed
    try {
      parsed = JSON.parse(raw.replace(/```json|```/g, "").trim())
    } catch {
      parsed = { alert_type: "normal", summary: entryText.slice(0, 50), urgency: 1 }
    }

    const aiAlertType = parsed.alert_type || "normal"
    const aiSummary = parsed.summary || entryText.slice(0, 50)
    const urgency = parsed.urgency || 1

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