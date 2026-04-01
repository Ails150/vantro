import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"
import Anthropic from "@anthropic-ai/sdk"

function getInstallerFromToken(request: Request) {
  const auth = request.headers.get("authorization")
  if (!auth?.startsWith("Bearer ")) return null
  try {
    const payload = JSON.parse(Buffer.from(auth.slice(7), "base64").toString())
    if (payload.exp < Date.now()) return null
    return payload
  } catch { return null }
}

export async function POST(request: Request) {
  const service = await createServiceClient()
  const body = await request.json()
  const { jobId, entryText } = body

  let resolvedUserId: string
  let resolvedCompanyId: string

  const auth = request.headers.get("authorization")
  if (auth?.startsWith("Bearer ")) {
    const installer = getInstallerFromToken(request)
    if (!installer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    resolvedUserId = installer.userId
    resolvedCompanyId = installer.companyId
  } else {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { data: u } = await service.from("users").select("id, company_id").eq("auth_user_id", user.id).single()
    if (!u) return NextResponse.json({ error: "User not found" }, { status: 404 })
    resolvedUserId = u.id
    resolvedCompanyId = u.company_id
  }

  let aiAlertType = null
  let aiSummary = null

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const completion = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [{ role: "user", content: "You are a construction site supervisor AI. Analyse this site diary entry and classify it. Reply with JSON only - no other text: {\"alert_type\": \"blocker\"|\"issue\"|\"none\", \"summary\": \"one sentence max 15 words\"}.\n\nBLOCKER = work cannot continue today. Examples: no workers on site, missing materials, access denied, safety hazard, waiting for delivery, nobody turned up.\nISSUE = problem that needs attention but work can continue. Examples: minor delay, quality concern, one person missing.\nNONE = normal progress update.\n\nEntry: " + entryText }]
    })
    const raw = completion.content[0].type === "text" ? completion.content[0].text : "{}"
    const cleaned = raw.replace(/```json/g, "").replace(/```/g, "").trim()
    const parsed = JSON.parse(cleaned)
    console.log('[diary] AI ok:', parsed)
    aiAlertType = parsed.alert_type || null
    aiSummary = parsed.summary || null
  } catch(e) { console.error('[diary] AI error:', String(e)) }

  const { data: entry } = await service.from("diary_entries").insert({
    job_id: jobId,
    company_id: resolvedCompanyId,
    user_id: resolvedUserId,
    entry_text: entryText,
    ai_alert_type: aiAlertType,
    ai_summary: aiSummary
  }).select().single()

  if (aiAlertType && aiAlertType !== "none") {
    const { data: job } = await service.from("jobs").select("name").eq("id", jobId).single()
    const { data: alertUser } = await service.from("users").select("name").eq("id", resolvedUserId).single()

    await service.from("alerts").insert({
      company_id: resolvedCompanyId,
      job_id: jobId,
      user_id: resolvedUserId,
      message: (aiAlertType === "blocker" ? "BLOCKER" : "ISSUE") + " - " + (aiSummary || entryText.slice(0, 100)),
      alert_type: aiAlertType,
      is_read: false,
      status: "open"
    })

    // Push notify admin and foreman
    const { data: admins } = await service.from("users")
      .select("push_token, name")
      .eq("company_id", resolvedCompanyId)
      .in("role", ["admin", "foreman"])
      .not("push_token", "is", null)

    if (admins && admins.length > 0) {
      const tokens = admins.map((a: any) => a.push_token).filter(Boolean)
      if (tokens.length > 0) {
        const { data: jobData } = await service.from("jobs").select("name").eq("id", jobId).single()
        await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(tokens.map((token: string) => ({
            to: token,
            sound: "default",
            title: aiAlertType === "blocker" ? "BLOCKER on site" : "Issue flagged",
            body: (jobData?.name || "Job") + ": " + (aiSummary || entryText.slice(0, 80)),
            data: { type: "diary_alert", jobId, alertType: aiAlertType },
            channelId: "vantro",
          })))
        }).catch(() => {})
      }
    }

    const { data: recipients } = await service.from("users").select("email, name").eq("company_id", resolvedCompanyId).in("role", ["admin", "foreman"])
    if (recipients && recipients.length > 0 && process.env.RESEND_API_KEY) {
      for (const recipient of recipients.filter((r: any) => r.email)) {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: "Vantro Alerts <alerts@getvantro.com>",
            to: recipient.email,
            subject: (aiAlertType === "blocker" ? "BLOCKER" : "ISSUE") + " - " + (job?.name || "Job"),
            html: "<div style=\"font-family:sans-serif\"><h2>Vantro Alert</h2><p><strong>" + (aiAlertType === "blocker" ? "BLOCKER" : "ISSUE") + "</strong></p><p>Job: " + (job?.name || "Unknown") + "</p><p>By: " + (alertUser?.name || "Unknown") + "</p><p>" + (aiSummary || entryText) + "</p><a href=\"https://app.getvantro.com/admin\">View Dashboard</a></div>"
          })
        }).catch(() => {})
      }
    }
  }

  return NextResponse.json({ success: true, entry })
}
// redeploy

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const jobId = searchParams.get('jobId')
  if (!jobId) return (await import('next/server')).NextResponse.json({ error: 'No jobId' }, { status: 400 })

  const service = await (await import('@/lib/supabase/server')).createServiceClient()
  const { data: entries } = await service
    .from('diary_entries')
    .select('id, entry_text, ai_alert_type, ai_summary, reply, replied_at, created_at, user_id')
    .eq('job_id', jobId)
    .order('created_at', { ascending: true })

  return (await import('next/server')).NextResponse.json({ entries: entries || [] })
}
