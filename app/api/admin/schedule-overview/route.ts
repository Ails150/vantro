// app/api/admin/schedule-overview/route.ts
//
// Aggregate KPIs + this-week + next-public-holiday + entitlement summary
// Drives the Scheduler -> Overview tab in one call.

import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

function daysBetween(start: string, end: string, isHalfDay: boolean): number {
  if (isHalfDay) return 0.5
  const s = new Date(start + "T00:00:00Z").getTime()
  const e = new Date(end + "T00:00:00Z").getTime()
  return Math.round((e - s) / 86400000) + 1
}

function startOfWeek(d: Date): Date {
  // Monday-start week
  const out = new Date(d)
  const day = out.getDay() // 0=Sun..6=Sat
  const diff = (day === 0 ? -6 : 1 - day)
  out.setDate(out.getDate() + diff)
  out.setHours(0, 0, 0, 0)
  return out
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

  const { data: company } = await service
    .from("companies")
    .select("country_code, default_schedule, sick_auto_approve")
    .eq("id", admin.company_id)
    .single()

  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)
  const weekStart = startOfWeek(today)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 6)
  const weekStartStr = weekStart.toISOString().slice(0, 10)
  const weekEndStr = weekEnd.toISOString().slice(0, 10)

  // ── Total team count
  const { count: teamCount } = await service
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("company_id", admin.company_id)
    .eq("is_active", true)

  // ── Time off today (working today = team - off today - day off)
  const { data: offToday } = await service
    .from("time_off_entries")
    .select("id, type, user_id")
    .eq("company_id", admin.company_id)
    .eq("status", "approved")
    .lte("start_date", todayStr)
    .gte("end_date", todayStr)

  const onTimeOffToday = offToday?.length || 0
  const offByType: Record<string, number> = {}
  for (const e of offToday || []) {
    offByType[e.type] = (offByType[e.type] || 0) + 1
  }

  // ── Pending approvals
  const { count: pendingCount } = await service
    .from("time_off_entries")
    .select("id", { count: "exact", head: true })
    .eq("company_id", admin.company_id)
    .eq("status", "pending")

  // ── Custom schedules — distinct user_ids in user_shifts active today
  const { data: shiftRows } = await service
    .from("user_shifts")
    .select("user_id")
    .eq("company_id", admin.company_id)
    .lte("effective_from", todayStr)
    .or(`effective_until.is.null,effective_until.gte.${todayStr}`)
  const uniqueOverrideUsers = new Set(
    (shiftRows || []).map((r: any) => r.user_id)
  )
  const customScheduleCount = uniqueOverrideUsers.size

  // ── Working today (rough: team total minus off-today minus day-off-by-default)
  // Simple model: if today is in default_schedule with enabled:false, everyone is off
  // unless they have a user_shift covering today (handled by uniqueOverrideUsers).
  const dayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]
  const todayKey = dayKeys[today.getDay()]
  const defaultDay = (company?.default_schedule as any)?.[todayKey]
  const dayEnabledByDefault = !!defaultDay?.enabled

  const expectedWorkingToday = dayEnabledByDefault
    ? Math.max(0, (teamCount || 0) - onTimeOffToday)
    : uniqueOverrideUsers.size // Only override users may be working today

  // ── Next public holiday
  const { data: nextHoliday } = await service
    .from("public_holidays")
    .select("name, holiday_date")
    .eq("country_code", company?.country_code || "GB")
    .gte("holiday_date", todayStr)
    .order("holiday_date", { ascending: true })
    .limit(1)
    .maybeSingle()

  // ── This week — approved time off
  const { data: weekTimeOff } = await service
    .from("time_off_entries")
    .select("id, type, start_date, end_date, is_half_day, users(name, full_name, initials)")
    .eq("company_id", admin.company_id)
    .eq("status", "approved")
    .lte("start_date", weekEndStr)
    .gte("end_date", weekStartStr)
    .order("start_date", { ascending: true })

  // ── Pending approvals (latest 3 for the alert banner detail)
  const { data: pendingPreview } = await service
    .from("time_off_entries")
    .select("id, type, start_date, end_date, created_at, users(name, full_name, initials)")
    .eq("company_id", admin.company_id)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(3)

  // ── Total entitlement and usage across team
  const { data: allowances } = await service
    .from("leave_allowances")
    .select("user_id, total_days, carried_over_days, leave_year_start, leave_year_end")
    .eq("company_id", admin.company_id)
    .lte("leave_year_start", todayStr)
    .gte("leave_year_end", todayStr)

  let totalEntitlement = 0
  let totalUsed = 0
  if (allowances && allowances.length > 0) {
    for (const a of allowances) {
      totalEntitlement +=
        Number(a.total_days) + Number(a.carried_over_days || 0)
    }
    // Calculate used from approved annual_leave entries within those windows
    const userIds = allowances.map((a: any) => a.user_id)
    const { data: approvedYearly } = await service
      .from("time_off_entries")
      .select("user_id, start_date, end_date, is_half_day")
      .eq("company_id", admin.company_id)
      .eq("status", "approved")
      .eq("type", "annual_leave")
      .in("user_id", userIds)

    const allowanceByUser: Record<string, any> = {}
    for (const a of allowances) allowanceByUser[a.user_id] = a

    for (const e of approvedYearly || []) {
      const a = allowanceByUser[e.user_id]
      if (
        a &&
        e.start_date >= a.leave_year_start &&
        e.end_date <= a.leave_year_end
      ) {
        totalUsed += daysBetween(e.start_date, e.end_date, !!e.is_half_day)
      }
    }
  } else {
    // Fall back: country default × team size
    const { data: cfg } = await service
      .from("country_configs")
      .select("default_holiday_days")
      .eq("country_code", company?.country_code || "GB")
      .single()
    totalEntitlement =
      Number(cfg?.default_holiday_days || 0) * (teamCount || 0)
  }

  return NextResponse.json({
    today: todayStr,
    week_start: weekStartStr,
    week_end: weekEndStr,
    country_code: company?.country_code || "GB",
    kpis: {
      team_size: teamCount || 0,
      working_today: expectedWorkingToday,
      on_time_off_today: onTimeOffToday,
      off_by_type: offByType,
      pending_approval_count: pendingCount || 0,
      custom_schedule_count: customScheduleCount,
    },
    next_public_holiday: nextHoliday || null,
    week_time_off: weekTimeOff || [],
    pending_preview: pendingPreview || [],
    entitlement: {
      total_days: Math.round(totalEntitlement * 10) / 10,
      used_days: Math.round(totalUsed * 10) / 10,
    },
  })
}
