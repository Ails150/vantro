import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { verifyInstallerToken } from "@/lib/auth"

// Returns the data needed to render the installer's schedule + calendar.
// Single endpoint that aggregates schedule, balance, entries, holidays, team context.
export async function GET(request: Request) {
  const installer = verifyInstallerToken(request)
  if (!installer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const start = searchParams.get("start") // YYYY-MM-DD
  const end = searchParams.get("end")     // YYYY-MM-DD

  // Default window: 90 days back, 365 days forward
  const today = new Date()
  const defaultStart = new Date(today.getTime() - 90 * 86400000).toISOString().slice(0, 10)
  const defaultEnd = new Date(today.getTime() + 365 * 86400000).toISOString().slice(0, 10)
  const startDate = start || defaultStart
  const endDate = end || defaultEnd

  const service = await createServiceClient()

  // Resolve user + company in one go
  const { data: me } = await service
    .from("users")
    .select("id, name, company_id, companies(country_code, default_schedule, timezone, leave_year_start_month, leave_year_start_day)")
    .eq("id", installer.userId)
    .single()
  if (!me?.company_id) return NextResponse.json({ error: "User not found" }, { status: 404 })

  const company = me.companies as any
  const countryCode = company?.country_code || "GB"

  // Country config (leave year, default entitlement)
  const { data: countryCfg } = await service
    .from("country_configs")
    .select("*")
    .eq("code", countryCode)
    .maybeSingle()

  // Compute current leave year window
  // leave_year_company_override: company setting takes priority over country default
  const leaveYearMonth = company?.leave_year_start_month ?? countryCfg?.leave_year_start_month ?? 4
  const leaveYearDay = company?.leave_year_start_day ?? countryCfg?.leave_year_start_day ?? 1
  const leaveYear = computeLeaveYear(new Date(), leaveYearMonth, leaveYearDay)

  // Per-user shift override (if any)
  const { data: shifts } = await service
    .from("user_shifts")
    .select("*")
    .eq("user_id", installer.userId)
    .order("effective_from", { ascending: false })
    .limit(1)
  const userShift = shifts && shifts.length > 0 ? shifts[0] : null

  // Resolve weekly schedule: user override else company default
  const weeklySchedule = userShift?.schedule || company?.default_schedule || defaultSchedule()

  // Leave allowance for current leave year
  const { data: allowance } = await service
    .from("leave_allowances")
    .select("*")
    .eq("user_id", installer.userId)
    .eq("leave_year_start", leaveYear.start)
    .maybeSingle()

  const entitlement = allowance?.days_total ?? countryCfg?.default_holiday_days ?? 28

  // All my entries within window + this leave year
  const queryStart = leaveYear.start < startDate ? leaveYear.start : startDate
  const queryEnd = leaveYear.end > endDate ? leaveYear.end : endDate

  const { data: myEntries } = await service
    .from("time_off_entries")
    .select("id, type, start_date, end_date, status, is_half_day, notes, created_at")
    .eq("user_id", installer.userId)
    .gte("end_date", queryStart)
    .lte("start_date", queryEnd)
    .order("start_date", { ascending: false })

  // Compute days used this leave year (approved + pending? approved only for now)
  const daysUsed = (myEntries || [])
    .filter((e) => e.status === "approved" && e.type === "annual_leave")
    .filter((e) => e.start_date >= leaveYear.start && e.end_date <= leaveYear.end)
    .reduce((sum, e) => sum + countDays(e.start_date, e.end_date, !!e.is_half_day), 0)

  // Team context: count of approved teammates per day in window
  // (anonymised — just a count, no names)
  const { data: teamApproved } = await service
    .from("time_off_entries")
    .select("start_date, end_date")
    .eq("company_id", me.company_id)
    .eq("status", "approved")
    .neq("user_id", installer.userId)
    .gte("end_date", startDate)
    .lte("start_date", endDate)

  // Build per-date count map
  const teamByDate: Record<string, number> = {}
  for (const e of teamApproved || []) {
    const days = expandDates(e.start_date, e.end_date)
    for (const d of days) {
      teamByDate[d] = (teamByDate[d] || 0) + 1
    }
  }
  const teamEntries = Object.entries(teamByDate).map(([date, count]) => ({ date, count }))

  // Public holidays in window for the company's country
  const { data: holidays } = await service
    .from("public_holidays")
    .select("holiday_date, name")
    .eq("country_code", countryCode)
    .gte("holiday_date", startDate)
    .lte("holiday_date", endDate)
    .order("holiday_date", { ascending: true })

  return NextResponse.json({
    user_id: me.id,
    user_name: me.name,
    country_code: countryCode,
    leave_year: leaveYear,
    balance: {
      entitlement,
      used: daysUsed,
      remaining: entitlement - daysUsed,
    },
    weekly_schedule: weeklySchedule,
    // notes_field_fixed: rename DB column 'notes' to 'note' for mobile compat
    my_entries: (myEntries || []).map((e) => ({
      id: e.id,
      type: e.type,
      start_date: e.start_date,
      end_date: e.end_date,
      status: e.status,
      is_half_day: e.is_half_day,
      note: e.notes,
      created_at: e.created_at,
    })),
    team_entries: teamEntries,
    public_holidays: (holidays || []).map((h) => ({
      date: h.holiday_date,
      name: h.name,
    })),
    window: { start: startDate, end: endDate },
  })
}

// Helper: compute current leave year window
function computeLeaveYear(today: Date, startMonth: number, startDay: number) {
  const year = today.getFullYear()
  const startThisYear = new Date(year, startMonth - 1, startDay)
  let yearStart: Date
  if (today >= startThisYear) {
    yearStart = startThisYear
  } else {
    yearStart = new Date(year - 1, startMonth - 1, startDay)
  }
  const yearEnd = new Date(yearStart.getFullYear() + 1, yearStart.getMonth(), yearStart.getDate() - 1)
  return {
    start: yearStart.toISOString().slice(0, 10),
    end: yearEnd.toISOString().slice(0, 10),
  }
}

// Helper: count days in a leave entry (half day = 0.5)
function countDays(start: string, end: string, halfDay: boolean): number {
  if (halfDay) return 0.5
  const s = new Date(start + "T00:00:00Z").getTime()
  const e = new Date(end + "T00:00:00Z").getTime()
  return Math.round((e - s) / 86400000) + 1
}

// Helper: expand a date range to an array of YYYY-MM-DD strings
function expandDates(start: string, end: string): string[] {
  const result: string[] = []
  const s = new Date(start + "T00:00:00Z")
  const e = new Date(end + "T00:00:00Z")
  for (let d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
    result.push(d.toISOString().slice(0, 10))
  }
  return result
}

// Helper: default schedule (Mon-Fri 8-5)
function defaultSchedule() {
  return {
    mon: { working: true, start: "08:00", end: "17:00" },
    tue: { working: true, start: "08:00", end: "17:00" },
    wed: { working: true, start: "08:00", end: "17:00" },
    thu: { working: true, start: "08:00", end: "17:00" },
    fri: { working: true, start: "08:00", end: "17:00" },
    sat: { working: false, start: null, end: null },
    sun: { working: false, start: null, end: null },
  }
}
