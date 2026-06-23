// lib/scheduling/resolver.ts
//
// SINGLE SOURCE OF TRUTH for "is this installer working right now?"
//
// Resolution order (first match wins):
//   1. Approved time off            → not working, reason='time_off', type=...
//   2. Public holiday (country)     → not working, reason='public_holiday'
//   3. User-specific shifts         → working if matched, else not_working
//   4. Company default_schedule     → working if today's day enabled
//
// Used by: /api/signin, compliance scoring, no-show alerts, admin dashboard.

import { createServiceClient } from "@/lib/supabase/server"

export type WorkingState = {
  working: boolean
  reason:
    | "time_off"
    | "public_holiday"
    | "shift"
    | "company_default"
    | "outside_hours"
    | "day_off"
    | "no_schedule"
  expectedSignIn?: string | null   // "HH:MM" in company timezone
  expectedSignOut?: string | null  // "HH:MM" in company timezone
  details?: {
    timeOffType?: string
    holidayName?: string
    shiftType?: string
  }
}

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const

/**
 * Resolve whether an installer is working at a given moment.
 *
 * @param userId    The installer's users.id
 * @param when      Defaults to now. Pass a Date to check past/future.
 * @returns         WorkingState describing the installer's status
 */
export async function isInstallerWorking(
  userId: string,
  when: Date = new Date()
): Promise<WorkingState> {
  const service = await createServiceClient()

  // Need company context for timezone, country, default schedule
  const { data: user } = await service
    .from("users")
    .select("id, company_id, companies(id, country_code, timezone, default_schedule)")
    .eq("id", userId)
    .single()

  if (!user || !user.companies) {
    return { working: false, reason: "no_schedule" }
  }

  const company = user.companies as any
  const dateOnly = when.toISOString().slice(0, 10) // YYYY-MM-DD UTC; good enough for date-only lookups
  const dayOfWeek = when.getDay() // 0=Sun .. 6=Sat
  const dayKey = DAY_KEYS[dayOfWeek]
  const timeStr = when.toTimeString().slice(0, 5) // "HH:MM"

  // ─── 1. Approved time off ────────────────────────────────────────────
  const { data: timeOff } = await service
    .from("time_off_entries")
    .select("type, is_half_day, half_day_period")
    .eq("user_id", userId)
    .eq("status", "approved")
    .lte("start_date", dateOnly)
    .gte("end_date", dateOnly)
    .limit(1)
    .maybeSingle()

  if (timeOff) {
    // Half-day handling: morning off → still working PM, and vice versa
    if (timeOff.is_half_day) {
      const hour = when.getHours()
      const isMorning = hour < 12
      const offThisHalf =
        (timeOff.half_day_period === "am" && isMorning) ||
        (timeOff.half_day_period === "pm" && !isMorning)
      if (!offThisHalf) {
        // The other half — fall through to shift/default resolution
      } else {
        return {
          working: false,
          reason: "time_off",
          details: { timeOffType: timeOff.type },
        }
      }
    } else {
      return {
        working: false,
        reason: "time_off",
        details: { timeOffType: timeOff.type },
      }
    }
  }

  // ─── 2. Public holiday (country-aware) ───────────────────────────────
  const { data: holiday } = await service
    .from("public_holidays")
    .select("name")
    .eq("country_code", company.country_code)
    .eq("holiday_date", dateOnly)
    .limit(1)
    .maybeSingle()

  if (holiday) {
    return {
      working: false,
      reason: "public_holiday",
      details: { holidayName: holiday.name },
    }
  }

  // ─── 3. User-specific shifts ─────────────────────────────────────────
  const { data: shifts } = await service
    .from("user_shifts")
    .select("shift_type, start_time, end_time, effective_from, effective_until")
    .eq("user_id", userId)
    .eq("day_of_week", dayOfWeek)
    .lte("effective_from", dateOnly)
    .or(`effective_until.is.null,effective_until.gte.${dateOnly}`)

  if (shifts && shifts.length > 0) {
    // Find a shift covering the current time
    const matching = shifts.find((s) => {
      return timeStr >= s.start_time.slice(0, 5) && timeStr <= s.end_time.slice(0, 5)
    })

    // Even if no shift covers right NOW, return today's primary shift hours
    // so callers get expected_sign_in / expected_sign_out for the day
    const primary = shifts[0]

    if (matching) {
      return {
        working: true,
        reason: "shift",
        expectedSignIn: primary.start_time.slice(0, 5),
        expectedSignOut: primary.end_time.slice(0, 5),
        details: { shiftType: matching.shift_type },
      }
    }
    return {
      working: false,
      reason: "outside_hours",
      expectedSignIn: primary.start_time.slice(0, 5),
      expectedSignOut: primary.end_time.slice(0, 5),
    }
  }

  // ─── 4. Company default schedule ─────────────────────────────────────
  const defaultSchedule = company.default_schedule || {}
  const todayDefault = defaultSchedule[dayKey]

  if (!todayDefault?.enabled) {
    return { working: false, reason: "day_off" }
  }

  const start = todayDefault.start || "08:00"
  const end = todayDefault.end || "17:00"
  const inHours = timeStr >= start && timeStr <= end

  return {
    working: inHours,
    reason: inHours ? "company_default" : "outside_hours",
    expectedSignIn: start,
    expectedSignOut: end,
  }
}

/**
 * Convenience: get expected sign-out time for compliance / signin route.
 * Returns "HH:MM" or null if no schedule applies today.
 */
export async function getExpectedSignOutTime(
  userId: string,
  when: Date = new Date()
): Promise<string | null> {
  const state = await isInstallerWorking(userId, when)
  return state.expectedSignOut ?? null
}

/**
 * Convenience: should we enforce sign-in compliance for this user/day?
 * False = installer legitimately not working (time off, holiday, day off).
 * True  = installer expected on the tools.
 */
export async function shouldEnforceCompliance(
  userId: string,
  when: Date = new Date()
): Promise<boolean> {
  const state = await isInstallerWorking(userId, when)

  // Don't enforce on time-off, public holidays, or scheduled days off
  if (
    state.reason === "time_off" ||
    state.reason === "public_holiday" ||
    state.reason === "day_off" ||
    state.reason === "no_schedule"
  ) {
    return false
  }
  return true
}
