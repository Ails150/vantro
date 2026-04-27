// app/api/installer/time-off/balance/route.ts
//
// Returns the installer's current annual-leave balance for the active leave year.
//
// Resolves to the leave_allowances row covering today's date; if missing,
// falls back to the country's default_holiday_days from country_configs.
// Counts approved annual_leave days within the active leave year window.

import { NextResponse } from "next/server"
import { verifyInstallerToken } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"

function daysBetween(start: string, end: string, isHalfDay: boolean): number {
  if (isHalfDay) return 0.5
  const s = new Date(start + "T00:00:00Z").getTime()
  const e = new Date(end + "T00:00:00Z").getTime()
  return Math.round((e - s) / 86400000) + 1
}

export async function GET(request: Request) {
  const installer = verifyInstallerToken(request)
  if (!installer)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const service = await createServiceClient()
  const today = new Date().toISOString().slice(0, 10)

  // 1. Get user + company country
  const { data: user } = await service
    .from("users")
    .select("company_id, companies(country_code)")
    .eq("id", installer.userId)
    .single()
  if (!user)
    return NextResponse.json({ error: "User not found" }, { status: 404 })

  const company = user.companies as any
  const countryCode = company?.country_code || "GB"

  // 2. Get active leave allowance row
  const { data: allowance } = await service
    .from("leave_allowances")
    .select("total_days, carried_over_days, leave_year_start, leave_year_end")
    .eq("user_id", installer.userId)
    .lte("leave_year_start", today)
    .gte("leave_year_end", today)
    .limit(1)
    .maybeSingle()

  let totalDays = 0
  let carriedOver = 0
  let leaveYearStart: string
  let leaveYearEnd: string

  if (allowance) {
    totalDays = Number(allowance.total_days)
    carriedOver = Number(allowance.carried_over_days || 0)
    leaveYearStart = allowance.leave_year_start
    leaveYearEnd = allowance.leave_year_end
  } else {
    // Fall back to country default
    const { data: cfg } = await service
      .from("country_configs")
      .select("default_holiday_days")
      .eq("country_code", countryCode)
      .single()
    totalDays = Number(cfg?.default_holiday_days || 0)
    carriedOver = 0
    // UK statutory leave year defaults to Apr 1 -> Mar 31; for others use calendar year
    const year = new Date().getFullYear()
    if (countryCode === "GB") {
      const month = new Date().getMonth() // 0-indexed
      const yearStart = month >= 3 ? year : year - 1
      leaveYearStart = `${yearStart}-04-01`
      leaveYearEnd = `${yearStart + 1}-03-31`
    } else {
      leaveYearStart = `${year}-01-01`
      leaveYearEnd = `${year}-12-31`
    }
  }

  // 3. Sum approved annual_leave days within the leave year
  const { data: approved } = await service
    .from("time_off_entries")
    .select("start_date, end_date, is_half_day")
    .eq("user_id", installer.userId)
    .eq("status", "approved")
    .eq("type", "annual_leave")
    .gte("start_date", leaveYearStart)
    .lte("end_date", leaveYearEnd)

  let usedDays = 0
  for (const e of approved || []) {
    usedDays += daysBetween(e.start_date, e.end_date, !!e.is_half_day)
  }

  const totalAvailable = totalDays + carriedOver
  const remainingDays = Math.max(0, totalAvailable - usedDays)

  return NextResponse.json({
    leave_year_start: leaveYearStart,
    leave_year_end: leaveYearEnd,
    total_days: totalDays,
    carried_over_days: carriedOver,
    used_days: usedDays,
    remaining_days: remainingDays,
  })
}
