import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"
import { GoogleGenerativeAI } from "@google/generative-ai"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

// In-memory cache (1hr TTL per company)
const cache = new Map<string, { data: any; expires: number }>()
const TTL_MS = 60 * 60 * 1000

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const service = await createServiceClient()
    const { data: userData } = await service
      .from("users")
      .select("company_id")
      .eq("auth_user_id", user.id)
      .single()
    if (!userData) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const companyId = userData.company_id
    const { searchParams } = new URL(request.url)
    const force = searchParams.get("refresh") === "1"

    const cached = cache.get(companyId)
    if (!force && cached && cached.expires > Date.now()) {
      return NextResponse.json({ ...cached.data, cached: true })
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    const { data: entries, error } = await service
      .from("diary_entries")
      .select("id, entry_text, ai_alert_type, status, created_at, job_id, user_id, jobs(name), users(name)")
      .eq("company_id", companyId)
      .gte("created_at", sevenDaysAgo)
      .order("created_at", { ascending: false })

    if (error) {
      console.error("[diary-insights] Query failed:", error)
      return NextResponse.json({ error: "Query failed", detail: error.message, hint: error.hint, code: error.code }, { status: 500 })
    }

    if (!entries || entries.length === 0) {
      const empty = {
        generated_at: new Date().toISOString(),
        entry_count: 0,
        insights: {
          recurring_themes: [],
          silent_jobs: [],
          unanswered_blockers: [],
          installer_patterns: [],
          trade_signals: []
        }
      }
      cache.set(companyId, { data: empty, expires: Date.now() + TTL_MS })
      return NextResponse.json(empty)
    }

    const { data: alerts } = await service
      .from("alerts")
      .select("id, message, status, resolved_at, diary_entry_id, created_at")
      .eq("company_id", companyId)
      .gte("created_at", sevenDaysAgo)

    const unansweredCount = (alerts || []).filter(
      (a: any) => a.status !== "resolved" && !a.resolved_at
    ).length

    const context = entries.map((e: any) => ({
      date: e.created_at,
      installer: e.users?.name || "Unknown",
      job: e.jobs?.name || "Unknown",
      status: e.status || "carrying_on",
      alert_type: e.ai_alert_type || "none",
      text: (e.entry_text || "").slice(0, 200)
    }))

    const prompt = `You are an operations analyst for a construction admin dashboard. Analyze these ${context.length} diary entries from the last 7 days and return STRICT JSON only — no preamble, no markdown fences.

Diary entries:
${JSON.stringify(context, null, 2)}

Total unresolved alerts in this period: ${unansweredCount}

Return JSON in this exact shape:
{
  "recurring_themes": [{"theme": "string", "count": number, "detail": "string"}],
  "silent_jobs": [{"job": "string", "last_entry": "ISO date", "detail": "string"}],
  "unanswered_blockers": [{"summary": "string", "count": number}],
  "installer_patterns": [{"installer": "string", "pattern": "string", "detail": "string"}],
  "trade_signals": []
}

Rules:
- Each array: 0-3 items max, only include genuinely notable findings
- "recurring_themes": material/delivery/access/spec issues mentioned 2+ times
- "silent_jobs": jobs with no entry in 36+ hours that had recent activity
- "unanswered_blockers": summarize the unresolved alerts at a high level
- "installer_patterns": shifts in entry status (more paused/stopped than typical)
- Be terse. One short sentence per detail. No fluff.
- If nothing notable in a category, return empty array.`

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: { responseMimeType: "application/json", temperature: 0.2 }
    })

    const result = await model.generateContent(prompt)
    const raw = result.response.text()

    let insights
    try {
      insights = JSON.parse(raw.replace(/^```json\s*|```$/g, "").trim())
    } catch (e) {
      console.error("[diary-insights] JSON parse failed:", raw.slice(0, 500))
      return NextResponse.json({ error: "AI returned invalid JSON" }, { status: 500 })
    }

    const payload = {
      generated_at: new Date().toISOString(),
      entry_count: entries.length,
      insights
    }

    cache.set(companyId, { data: payload, expires: Date.now() + TTL_MS })
    return NextResponse.json(payload)
  } catch (err: any) {
    console.error("[diary-insights] Error:", err)
    return NextResponse.json({ error: err.message || "Server error" }, { status: 500 })
  }
}
