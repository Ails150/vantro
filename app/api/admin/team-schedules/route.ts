// app/api/admin/team-schedules/route.ts
//
// List every installer with: their effective schedule (custom vs default)
// and their entitlement balance for the leave year.
// Drives the Scheduler -> Team tab.

import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const

function daysBetween(start: string, end: string, isHalfDay: boolean): number {
  if (isHalfDay) return 0.5
  const s = new Date(start + "T00:00:00Z").getTime()
  const e = new Date(end + "T00:00:00Z").getTime()
  return Math.round((e - s) / 86400000) + 1
}

function summariseShifts(shifts: Array<{ day_of_week: number; start_time: string; end_time: string }>): string {
  if (!shifts.length) return "No shifts"
  const byDay: Record<number, { start: string; end: string }> = {}
  for (const s of shifts)
    byDay[s.day_of_week] = {
      start: s.start_time.slice(0, 5),
      end: s.end_time.slice(0, 5),
    }
  const weekdays = [1, 2, 3, 4, 5]
  const allWeekdays = weekdays.every((d) => byDay[d])
  const allWeekdaysSame =
    allWeekdays &&
    weekdays.every(
      (d) =>
        byDay[d].start === byDay[1].start && byDay[d].end === byDay[1].end
    )
  const sat = byDay[6]
  const sun = byDay[0]
  if (allWeekdaysSame && !sat && !sun) {
    return `Mon–Fri ${byDay[1].start}–${byDay[1].end}`
  }
  if (allWeekdaysSame && sat && !sun) {
    if (sat.start === byDay[1].start && sat.end === byDay[1].end)
      return `Mon–Sat ${byDay[1].start}–${byDay[1].end}`
  }
  const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  const parts: string[] = []
  for (let d = 0; d < 7; d++) {
    if (byDay[d]) parts.push(`${labels[d]} ${byDay[d].start}–${byDay[d].end}`)
  }
  return parts.join(", ")
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const service = await createServiceClient()
  const { data: admin } = await service
    .from("users")
    .select("id, company_id, role")
    .eq("auth_user_id", user.id)
    .single()
  if (!admin || !["admin", "foreman"].includes(admin.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const today = new Date().toISOString().slice(0, 10)

  const { data: company } = await service
    .from("companies")
    .select("default_schedule, country_code")
    .eq("id", admin.company_id)
    .single()
  const defaultSchedule = (company?.default_schedule as any) || {}

  const enabledDefaults: Record<string, { start: string; end: string }> = {}
  for (const k of DAY_KEYS) {
    const day = defaultSchedule[k]
    if (day?.enabled && day.start && day.end) {
      enabledDefaults[k] = { start: day.start, end: day.end }
    }
  }
  const defaultSummary = (() => {
    const days = Object.keys(enabledDefaults)
    if (days.length === 0) return "No working days"
    const allSame = days.every(
      (d) =>
        enabledDefaults[d].start === enabledDefaults[days[0]].start &&
        enabledDefaults[d].end === enabledDefaults[days[0]].end
    )
    const weekdayOrder = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
    const orderedDays = weekdayOrder.filter((d) => enabledDefaults[d])
    if (allSame && orderedDays.join(",") === "mon,tue,wed,thu,fri") {
      const f = enabledDefaults[orderedDays[0]]
      return `Mon–Fri ${f.start}–${f.end}`
    }
    if (allSame && orderedDays.join(",") === "mon,tue,wed,thu,fri,sat") {
      const f = enabledDefaults[orderedDays[0]]
      return `Mon–Sat ${f.start}–${f.end}`
    }
    const labels: Record<string, string> = {
      mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu",
      fri: "Fri", sat: "Sat", sun: "Sun",
    }
    return orderedDays
      .map((d) => `${labels[d]} ${enabledDefaults[d].start}–${enabledDefaults[d].end}`)
      .join(", ")
  })()

  // Users — only real columns (name, initials)
  const { data: users } = await service
    .from("users")
    .select("id, name, initials, role, is_active")
    .eq("company_id", admin.company_id)
    .or("is_active.is.null,is_active.eq.true")
    .order("name", { ascending: true })

  if (!users) return NextResponse.json({ users: [] })

  // Filter installers + foreman only (not admins)
  const teamUsers = users.filter((u: any) =>
    ["installer", "foreman"].includes(u.role)
  )

  const userIds = teamUsers.map((u: any) => u.id)

  // Active shifts for all users
  const { data: shifts } = await service
    .from("user_shifts")
    .select("user_id, day_of_week, start_time, end_time, shift_type")
    .in("user_id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"])
    .lte("effective_from", today)
    .or(`effective_until.is.null,effective_until.gte.${today}`)

  const shiftsByUser: Record<string, any[]> = {}
  for (const s of shifts || []) {
    if (!shiftsByUser[s.user_id]) shiftsByUser[s.user_id] = []
    shiftsByUser[s.user_id].push(s)
  }

  // Active leave allowances
  const { data: allowances } = await service
    .from("leave_allowances")
    .select(
      "user_id, total_days, carried_over_days, leave_year_start, leave_year_end"
    )
    .in("user_id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"])
    .lte("leave_year_start", today)
    .gte("leave_year_end", today)

  const allowanceByUser: Record<string, any> = {}
  for (const a of allowances || []) allowanceByUser[a.user_id] = a

  const { data: cfg } = await service
    .from("country_configs")
    .select("default_holiday_days")
    .eq("country_code", company?.country_code || "GB")
    .single()
  const fallbackTotal = Number(cfg?.default_holiday_days || 0)

  const { data: approvedAL } = await service
    .from("time_off_entries")
    .select("user_id, start_date, end_date, is_half_day")
    .eq("company_id", admin.company_id)
    .eq("status", "approved")
    .eq("type", "annual_leave")
    .in("user_id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"])

  const usedByUser: Record<string, number> = {}
  for (const e of approvedAL || []) {
    const allowance = allowanceByUser[e.user_id]
    if (
      !allowance ||
      (e.start_date >= allowance.leave_year_start &&
        e.end_date <= allowance.leave_year_end)
    ) {
      usedByUser[e.user_id] =
        (usedByUser[e.user_id] || 0) +
        daysBetween(e.start_date, e.end_date, !!e.is_half_day)
    }
  }

  const rows = teamUsers.map((u: any) => {
    const userShifts = shiftsByUser[u.id] || []
    const hasOverride = userShifts.length > 0
    const summary = hasOverride ? summariseShifts(userShifts) : defaultSummary
    const allowance = allowanceByUser[u.id]
    const total = allowance
      ? Number(allowance.total_days) + Number(allowance.carried_over_days || 0)
      : fallbackTotal
    const used = Math.round((usedByUser[u.id] || 0) * 10) / 10
    const name = u.name || "(unnamed)"
    return {
      id: u.id,
      name,
      initials: u.initials || name.slice(0, 2).toUpperCase(),
      role: u.role,
      schedule_summary: summary,
      schedule_source: hasOverride ? "custom" : "default",
      entitlement_total_days: total,
      entitlement_used_days: used,
      entitlement_remaining_days: Math.max(0, total - used),
    }
  })

  return NextResponse.json({
    company_default_summary: defaultSummary,
    users: rows,
    counts: {
      total: rows.length,
      default: rows.filter((r: { schedule_source: string }) => r.schedule_source === "default").length,
      custom: rows.filter((r: { schedule_source: string }) => r.schedule_source === "custom").length,
    },
  })
}
