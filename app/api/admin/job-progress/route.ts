import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"
import { GoogleGenerativeAI } from "@google/generative-ai"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

const cache = new Map<string, { data: any; expires: number }>()
const TTL_MS = 30 * 60 * 1000

type Signal = "green" | "yellow" | "red" | "unknown"

function pickWorst(signals: Signal[]): Signal {
  if (signals.includes("red")) return "red"
  if (signals.includes("yellow")) return "yellow"
  if (signals.every(s => s === "unknown")) return "unknown"
  return "green"
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const service = await createServiceClient()
    const { data: u } = await service.from("users").select("company_id, role").eq("auth_user_id", user.id).single()
    if (!u || !["admin","foreman"].includes(u.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const companyId = u.company_id
    const force = new URL(request.url).searchParams.get("refresh") === "1"
    const cached = cache.get(companyId)
    if (!force && cached && cached.expires > Date.now()) {
      return NextResponse.json({ ...cached.data, cached: true })
    }

    // Get active jobs
    const { data: jobs, error: jobsErr } = await service
      .from("jobs")
      .select("id, name, start_date, end_date, budget_hours, status, checklist_template_id")
      .eq("company_id", companyId)
      .eq("status", "active")

    if (jobsErr) {
      console.error("[job-progress] jobs query failed:", jobsErr)
      return NextResponse.json({ error: "Query failed", detail: jobsErr.message }, { status: 500 })
    }

    const today = new Date()
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    const results = await Promise.all((jobs || []).map(async (job: any) => {
      // Hours: sum signins
      const { data: signins } = await service
        .from("signins")
        .select("signed_in_at, signed_out_at, hours_worked")
        .eq("job_id", job.id)

      let totalHours = 0
      for (const s of (signins || [])) {
        if (s.hours_worked != null) {
          totalHours += Number(s.hours_worked)
        } else if (s.signed_in_at && s.signed_out_at) {
          const ms = new Date(s.signed_out_at).getTime() - new Date(s.signed_in_at).getTime()
          totalHours += ms / 1000 / 3600
        }
      }
      totalHours = Math.round(totalHours * 10) / 10

      // Activity: last diary entry
      const { data: lastDiary } = await service
        .from("diary_entries")
        .select("created_at, entry_text, ai_alert_type")
        .eq("job_id", job.id)
        .order("created_at", { ascending: false })
        .limit(5)

      const lastDiaryAt = lastDiary && lastDiary[0] ? lastDiary[0].created_at : null
      const recentDiary = (lastDiary || []).filter((d: any) => d.created_at >= sevenDaysAgo)

      // Recent unresolved blockers
      const { data: openBlockers } = await service
        .from("alerts")
        .select("id, message, created_at")
        .eq("job_id", job.id)
        .eq("alert_type", "blocker")
        .eq("is_read", false)
      const openBlockerCount = (openBlockers || []).length

      // Checklist progress (if template linked)
      let checklistTotal = 0
      let checklistComplete = 0
      if (job.checklist_template_id) {
        const { data: items } = await service
          .from("checklist_items")
          .select("id")
          .eq("template_id", job.checklist_template_id)
        checklistTotal = (items || []).length
        // Count signed-off items via checklist_run_items if it exists
        // (best-effort: skip if table is missing)
        try {
          const { data: runs } = await service
            .from("checklist_run_items")
            .select("id, status")
            .eq("job_id", job.id)
            .in("status", ["pass", "passed", "complete", "completed"])
          checklistComplete = (runs || []).length
        } catch {}
      }

      // Calendar signal
      let calendarSignal: Signal = "unknown"
      let daysRemaining: number | null = null
      let timeElapsedPct: number | null = null
      if (job.end_date) {
        const end = new Date(job.end_date)
        const msLeft = end.getTime() - today.getTime()
        daysRemaining = Math.round(msLeft / 1000 / 3600 / 24)
        if (job.start_date) {
          const start = new Date(job.start_date)
          const totalMs = end.getTime() - start.getTime()
          const usedMs = today.getTime() - start.getTime()
          timeElapsedPct = totalMs > 0 ? Math.round((usedMs / totalMs) * 100) : null
        }
        if (daysRemaining < 0) calendarSignal = "red"
        else if (daysRemaining <= 2) calendarSignal = "yellow"
        else calendarSignal = "green"
      }

      // Hours signal
      let hoursSignal: Signal = "unknown"
      let hoursPct: number | null = null
      if (job.budget_hours && job.budget_hours > 0) {
        hoursPct = Math.round((totalHours / Number(job.budget_hours)) * 100)
        if (hoursPct >= 100) hoursSignal = "red"
        else if (hoursPct >= 85) hoursSignal = "yellow"
        else hoursSignal = "green"
      }

      // Activity signal
      let activitySignal: Signal = "unknown"
      let daysSinceLastDiary: number | null = null
      if (lastDiaryAt) {
        daysSinceLastDiary = Math.floor((today.getTime() - new Date(lastDiaryAt).getTime()) / 1000 / 3600 / 24)
        if (daysSinceLastDiary >= 3) activitySignal = "red"
        else if (daysSinceLastDiary >= 2) activitySignal = "yellow"
        else activitySignal = "green"
      } else {
        // No diary at all but is active
        activitySignal = "yellow"
      }

      const overall = pickWorst([calendarSignal, hoursSignal, activitySignal])

      return {
        id: job.id,
        name: job.name,
        start_date: job.start_date,
        end_date: job.end_date,
        budget_hours: job.budget_hours,
        actual_hours: totalHours,
        days_remaining: daysRemaining,
        time_elapsed_pct: timeElapsedPct,
        hours_pct: hoursPct,
        days_since_last_diary: daysSinceLastDiary,
        open_blockers: openBlockerCount,
        checklist_total: checklistTotal,
        checklist_complete: checklistComplete,
        signals: {
          calendar: calendarSignal,
          hours: hoursSignal,
          activity: activitySignal,
        },
        overall,
        recent_diary: recentDiary.slice(0, 8).map((d: any) => ({
          text: (d.entry_text || "").slice(0, 200),
          alert_type: d.ai_alert_type,
          at: d.created_at,
        })),
      }
    }))

    // Generate "Why" sentences for non-green jobs in one batched Gemini call
    const flagged = results.filter(r => r.overall === "red" || r.overall === "yellow")
    let whyMap: Record<string, string> = {}
    if (flagged.length > 0) {
      try {
        const prompt = `You are an operations analyst. For each flagged construction job below, write ONE short sentence (max 25 words) explaining why it is flagged. Reference specific signals (calendar, hours, activity, blockers) and diary entries where relevant. Return STRICT JSON: { "<job_id>": "sentence", ... } and nothing else.

Jobs:
${JSON.stringify(flagged.map(f => ({
  id: f.id,
  name: f.name,
  status: f.overall,
  days_remaining: f.days_remaining,
  hours_pct: f.hours_pct,
  days_since_last_diary: f.days_since_last_diary,
  open_blockers: f.open_blockers,
  recent_diary_summaries: f.recent_diary.map(d => d.text),
})), null, 2)}`

        const model = genAI.getGenerativeModel({
          model: "gemini-2.5-flash",
          generationConfig: { responseMimeType: "application/json", temperature: 0.2 }
        })
        const result = await model.generateContent(prompt)
        const raw = result.response.text()
        whyMap = JSON.parse(raw.replace(/^```json\s*|```$/g, "").trim())
      } catch (e: any) {
        console.warn("[job-progress] Gemini explanation failed:", e?.message || e)
      }
    }

    const enriched = results.map(r => ({ ...r, why: whyMap[r.id] || null }))

    const payload = {
      generated_at: new Date().toISOString(),
      job_count: enriched.length,
      jobs: enriched,
    }

    cache.set(companyId, { data: payload, expires: Date.now() + TTL_MS })
    return NextResponse.json(payload)
  } catch (err: any) {
    console.error("[job-progress] Error:", err)
    return NextResponse.json({ error: "Server error", detail: err?.message }, { status: 500 })
  }
}
