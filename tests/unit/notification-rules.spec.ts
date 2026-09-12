import { test, expect } from "@playwright/test"
import {
  DEFAULT_QUIET_HOURS,
  GEOFENCE_ACCURACY_LIMIT_M,
  GEOFENCE_DWELL_MINUTES,
  evaluateGeofenceAutoSignout,
  isJobNotifiable,
  isPushAllowed,
  isQuietHour,
  parseHhmm,
  resolveScheduledDay,
  shouldSendSigninReminder,
  type LocationFix,
  type NotifiableJob,
  type QuietHours,
} from "../../lib/notifications/rules"

/**
 * The rules that decide whether a worker's phone buzzes.
 *
 * These exist because a worker was pushed "signed out automatically" roughly
 * every five minutes for a day and a half, on a Saturday, while not signed in
 * and not on site. Each describe block below is one of the rules that was
 * missing or wrong. Where a case is drawn from that incident it says so.
 *
 * Pure functions, no browser and no network: this file runs in the "unit"
 * Playwright project, which has no baseURL and does not start a server.
 */

const QUIET: QuietHours = DEFAULT_QUIET_HOURS
const at = (hhmm: string) => parseHhmm(hhmm)!

// 2026-09-12 is a Saturday, 2026-09-11 a Friday. The incident dates.
const SAT = 6
const SUN = 0
const FRI = 5
const MON = 1

const ACTIVE_JOB: NotifiableJob = {
  id: "job-1",
  status: "active",
  archived_at: null,
  completed_at: null,
  start_date: "2026-01-05",
  end_date: null,
}

// ---------------------------------------------------------------------------
// Rule 5: quiet hours, default 19:00 -> 06:00, no weekend pushes
// ---------------------------------------------------------------------------

test.describe("rule 5: quiet hours and weekends", () => {
  test("the default window is 7pm to 6am and wraps midnight", () => {
    expect(DEFAULT_QUIET_HOURS.start).toBe("19:00")
    expect(DEFAULT_QUIET_HOURS.end).toBe("06:00")
    expect(DEFAULT_QUIET_HOURS.weekendPush).toBe(false)

    expect(isQuietHour(at("18:59"), QUIET)).toBe(false)
    expect(isQuietHour(at("19:00"), QUIET)).toBe(true)
    expect(isQuietHour(at("23:59"), QUIET)).toBe(true)
    expect(isQuietHour(at("00:00"), QUIET)).toBe(true)
    expect(isQuietHour(at("03:00"), QUIET)).toBe(true)
    expect(isQuietHour(at("05:59"), QUIET)).toBe(true)
    // End is exclusive: 06:00 is the first minute pushes resume.
    expect(isQuietHour(at("06:00"), QUIET)).toBe(false)
    expect(isQuietHour(at("12:00"), QUIET)).toBe(false)
  })

  test("a non-wrapping window is a plain range", () => {
    const daytimeQuiet: QuietHours = { start: "09:00", end: "17:00", weekendPush: false }
    expect(isQuietHour(at("08:59"), daytimeQuiet)).toBe(false)
    expect(isQuietHour(at("09:00"), daytimeQuiet)).toBe(true)
    expect(isQuietHour(at("16:59"), daytimeQuiet)).toBe(true)
    expect(isQuietHour(at("17:00"), daytimeQuiet)).toBe(false)
    expect(isQuietHour(at("22:00"), daytimeQuiet)).toBe(false)
  })

  test("start equal to end mutes the whole day rather than none of it", () => {
    const alwaysQuiet: QuietHours = { start: "08:00", end: "08:00", weekendPush: false }
    expect(isQuietHour(at("08:00"), alwaysQuiet)).toBe(true)
    expect(isQuietHour(at("20:00"), alwaysQuiet)).toBe(true)
  })

  test("no pushes on Saturday or Sunday when the worker is not scheduled", () => {
    for (const dayIndex of [SAT, SUN]) {
      const gate = isPushAllowed({
        minutesOfDay: at("10:00"),
        dayIndex,
        scheduledToday: false,
        quiet: QUIET,
      })
      expect(gate.allowed).toBe(false)
      expect(gate.reason).toBe("weekend_not_scheduled")
    }
  })

  test("a worker rostered on a Saturday still gets their pushes", () => {
    const gate = isPushAllowed({
      minutesOfDay: at("10:00"),
      dayIndex: SAT,
      scheduledToday: true,
      quiet: QUIET,
    })
    expect(gate.allowed).toBe(true)
  })

  test("a company can opt weekends back in without rostering anyone", () => {
    const gate = isPushAllowed({
      minutesOfDay: at("10:00"),
      dayIndex: SUN,
      scheduledToday: false,
      quiet: { ...QUIET, weekendPush: true },
    })
    expect(gate.allowed).toBe(true)
  })

  test("quiet hours still apply on a scheduled weekend day", () => {
    const gate = isPushAllowed({
      minutesOfDay: at("22:30"),
      dayIndex: SAT,
      scheduledToday: true,
      quiet: QUIET,
    })
    expect(gate.allowed).toBe(false)
    expect(gate.reason).toBe("quiet_hours")
  })

  test("quiet hours apply on weekdays too", () => {
    expect(
      isPushAllowed({ minutesOfDay: at("05:30"), dayIndex: MON, scheduledToday: true, quiet: QUIET })
        .reason,
    ).toBe("quiet_hours")
    expect(
      isPushAllowed({ minutesOfDay: at("08:00"), dayIndex: MON, scheduledToday: true, quiet: QUIET })
        .allowed,
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Schedule resolution: which source wins
// ---------------------------------------------------------------------------

test.describe("schedule resolution", () => {
  // The real shape on the account that was being spammed: weekly_schedule says
  // Saturday is off. The old resolver never read this field at all.
  const weeklySchedule = {
    mon: { working: true, sign_in: "08:00", sign_out: "17:00" },
    tue: { working: true, sign_in: "08:00", sign_out: "17:00" },
    wed: { working: true, sign_in: "08:00", sign_out: "17:00" },
    thu: { working: true, sign_in: "08:00", sign_out: "17:00" },
    fri: { working: true, sign_in: "08:00", sign_out: "17:00" },
    sat: { working: false, sign_in: null, sign_out: null },
    sun: { working: false, sign_in: null, sign_out: null },
  }

  test("weekly_schedule is read, and says Saturday is off", () => {
    const sat = resolveScheduledDay(SAT, { weeklySchedule })
    expect(sat.scheduled).toBe(false)
    expect(sat.source).toBe("weekly_schedule")

    const fri = resolveScheduledDay(FRI, { weeklySchedule })
    expect(fri.scheduled).toBe(true)
    expect(fri.startTime).toBe("08:00")
  })

  test("an explicit user shift beats the weekly schedule", () => {
    const sat = resolveScheduledDay(SAT, {
      shifts: [{ start_time: "07:00:00", end_time: "12:00:00" }],
      weeklySchedule,
    })
    expect(sat.scheduled).toBe(true)
    expect(sat.source).toBe("user_shift")
    expect(sat.startTime).toBe("07:00")
  })

  test("the company default only applies when the worker has no schedule", () => {
    const companyDefault = {
      sat: { enabled: false },
      mon: { enabled: true, start: "08:00", end: "17:30" },
    }
    expect(resolveScheduledDay(MON, { companyDefault }).source).toBe("company_default")
    expect(resolveScheduledDay(MON, { companyDefault }).scheduled).toBe(true)
    expect(resolveScheduledDay(SAT, { companyDefault }).scheduled).toBe(false)

    // ...and is overridden where the worker has one.
    expect(resolveScheduledDay(SAT, { weeklySchedule, companyDefault }).source).toBe(
      "weekly_schedule",
    )
  })

  test("no schedule anywhere means not scheduled, not 'assume weekdays'", () => {
    const resolved = resolveScheduledDay(MON, {})
    expect(resolved.scheduled).toBe(false)
    expect(resolved.source).toBe("none")
  })
})

// ---------------------------------------------------------------------------
// Rule 3: sign-in reminders
// ---------------------------------------------------------------------------

test.describe("rule 3: sign-in reminders", () => {
  const base = {
    dayIndex: MON,
    localDateStr: "2026-09-14",
    shiftStart: "08:00",
    scheduled: true,
    alreadySignedIn: false,
    alreadyReminded: false,
    hasPushToken: true,
    protectedReason: null as string | null,
    job: ACTIVE_JOB,
    quiet: QUIET,
  }

  test("fires from shift start minus 15 to shift start plus 30, and nowhere else", () => {
    const send = (hhmm: string) =>
      shouldSendSigninReminder({ ...base, minutesOfDay: at(hhmm) })

    expect(send("07:44").send).toBe(false)
    expect(send("07:44").reason).toBe("outside_reminder_window")

    expect(send("07:45").send).toBe(true) // start - 15, inclusive
    expect(send("08:00").send).toBe(true) // start
    expect(send("08:30").send).toBe(true) // start + 30, inclusive

    expect(send("08:31").send).toBe(false)
    expect(send("08:31").reason).toBe("outside_reminder_window")
    expect(send("14:00").send).toBe(false)
  })

  test("the body counts down before the shift and asks after it", () => {
    expect(shouldSendSigninReminder({ ...base, minutesOfDay: at("07:50") }).minutesFromStart).toBe(-10)
    expect(shouldSendSigninReminder({ ...base, minutesOfDay: at("08:20") }).minutesFromStart).toBe(20)
  })

  test("never on a day the worker is not scheduled", () => {
    const d = shouldSendSigninReminder({ ...base, minutesOfDay: at("08:00"), scheduled: false })
    expect(d.send).toBe(false)
    expect(d.reason).toBe("not_scheduled_today")
  })

  // The reported bug: Saturday, in the window, nothing else wrong.
  test("never on a weekend the worker is not scheduled for", () => {
    const d = shouldSendSigninReminder({
      ...base,
      minutesOfDay: at("07:50"),
      dayIndex: SAT,
      localDateStr: "2026-09-12",
      scheduled: false,
    })
    expect(d.send).toBe(false)
    expect(d.reason).toBe("not_scheduled_today")
  })

  test("but does fire on a weekend the schedule does cover", () => {
    const d = shouldSendSigninReminder({
      ...base,
      minutesOfDay: at("07:50"),
      dayIndex: SAT,
      localDateStr: "2026-09-12",
      scheduled: true,
    })
    expect(d.send).toBe(true)
  })

  test("never if already signed in, including on another job", () => {
    const d = shouldSendSigninReminder({
      ...base,
      minutesOfDay: at("08:00"),
      alreadySignedIn: true,
    })
    expect(d.send).toBe(false)
    expect(d.reason).toBe("already_signed_in")
  })

  test("once per shift, not repeated", () => {
    const first = shouldSendSigninReminder({ ...base, minutesOfDay: at("07:50") })
    expect(first.send).toBe(true)

    // Same shift, next cron tick, reminder already recorded.
    const second = shouldSendSigninReminder({
      ...base,
      minutesOfDay: at("07:55"),
      alreadyReminded: true,
    })
    expect(second.send).toBe(false)
    expect(second.reason).toBe("already_reminded")
  })

  test("a five-minute cron cannot send twice across the window on its own", () => {
    // Without the dedupe flag the window is 46 minutes wide, so ten ticks land
    // in it. This is exactly why "once per shift" cannot rest on window width.
    const ticks: string[] = []
    for (let m = 7 * 60 + 45; m <= 8 * 60 + 30; m += 5) {
      const hh = String(Math.floor(m / 60)).padStart(2, "0")
      const mm = String(m % 60).padStart(2, "0")
      if (shouldSendSigninReminder({ ...base, minutesOfDay: at(`${hh}:${mm}`) }).send) {
        ticks.push(`${hh}:${mm}`)
      }
    }
    expect(ticks.length).toBeGreaterThan(1)

    // With it, exactly one.
    let sent = 0
    let reminded = false
    for (let m = 7 * 60 + 45; m <= 8 * 60 + 30; m += 5) {
      const hh = String(Math.floor(m / 60)).padStart(2, "0")
      const mm = String(m % 60).padStart(2, "0")
      const d = shouldSendSigninReminder({
        ...base,
        minutesOfDay: at(`${hh}:${mm}`),
        alreadyReminded: reminded,
      })
      if (d.send) {
        sent++
        reminded = true
      }
    }
    expect(sent).toBe(1)
  })

  test("time off and public holidays mute the reminder", () => {
    const d = shouldSendSigninReminder({
      ...base,
      minutesOfDay: at("08:00"),
      protectedReason: "time_off_or_holiday",
    })
    expect(d.send).toBe(false)
    expect(d.reason).toBe("time_off_or_holiday")
  })

  test("no push token, no push", () => {
    expect(
      shouldSendSigninReminder({ ...base, minutesOfDay: at("08:00"), hasPushToken: false }).reason,
    ).toBe("no_push_token")
  })

  test("quiet hours beat the window for an early shift", () => {
    const d = shouldSendSigninReminder({
      ...base,
      shiftStart: "05:00",
      minutesOfDay: at("04:50"),
    })
    expect(d.send).toBe(false)
    expect(d.reason).toBe("quiet_hours")
  })
})

// ---------------------------------------------------------------------------
// Rule 4: never about a job that is archived, completed, or not theirs
// ---------------------------------------------------------------------------

test.describe("rule 4: the job must be live and assigned", () => {
  const today = "2026-09-14"

  test("an active, in-range job notifies", () => {
    expect(isJobNotifiable(ACTIVE_JOB, today).allowed).toBe(true)
  })

  test("an archived job never notifies", () => {
    const d = isJobNotifiable({ ...ACTIVE_JOB, archived_at: "2026-09-01T00:00:00Z" }, today)
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe("job_archived")
  })

  test("a completed job never notifies", () => {
    const d = isJobNotifiable({ ...ACTIVE_JOB, completed_at: "2026-09-10T16:00:00Z" }, today)
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe("job_completed")
  })

  test("a non-active status never notifies", () => {
    expect(isJobNotifiable({ ...ACTIVE_JOB, status: "on_hold" }, today).reason).toBe(
      "job_status_on_hold",
    )
    expect(isJobNotifiable({ ...ACTIVE_JOB, status: "archived" }, today).reason).toBe(
      "job_status_archived",
    )
  })

  test("a job outside its own date range never notifies", () => {
    expect(isJobNotifiable({ ...ACTIVE_JOB, start_date: "2026-10-01" }, today).reason).toBe(
      "job_not_started",
    )
    expect(isJobNotifiable({ ...ACTIVE_JOB, end_date: "2026-09-13" }, today).reason).toBe(
      "job_ended",
    )
    // Inclusive at both edges.
    expect(isJobNotifiable({ ...ACTIVE_JOB, start_date: today, end_date: today }, today).allowed).toBe(
      true,
    )
  })

  test("an archived job cannot produce a sign-in reminder even mid-window", () => {
    const d = shouldSendSigninReminder({
      minutesOfDay: at("08:00"),
      dayIndex: MON,
      localDateStr: today,
      shiftStart: "08:00",
      scheduled: true,
      alreadySignedIn: false,
      alreadyReminded: false,
      hasPushToken: true,
      job: { ...ACTIVE_JOB, archived_at: "2026-09-01T00:00:00Z" },
      quiet: QUIET,
    })
    expect(d.send).toBe(false)
    expect(d.reason).toBe("job_archived")
  })
})

// ---------------------------------------------------------------------------
// Rule 2: geofence auto sign-out
// ---------------------------------------------------------------------------

test.describe("rule 2: auto sign-out on location", () => {
  const t0 = new Date("2026-09-14T09:00:00Z")
  const now = new Date("2026-09-14T10:00:00Z")
  const fix = (minutesAfterT0: number, within: boolean, accuracy: number | null): LocationFix => ({
    logged_at: new Date(t0.getTime() + minutesAfterT0 * 60000).toISOString(),
    within_range: within,
    accuracy_metres: accuracy,
  })

  test("never when no shift is open", () => {
    const d = evaluateGeofenceAutoSignout({
      shiftOpen: false,
      fixes: [fix(0, false, 10), fix(20, false, 10)],
      now,
    })
    expect(d.signOut).toBe(false)
    expect(d.reason).toBe("no_open_shift")
  })

  test("never on a single fix", () => {
    const d = evaluateGeofenceAutoSignout({ shiftOpen: true, fixes: [fix(0, false, 10)], now })
    expect(d.signOut).toBe(false)
    expect(d.reason).toBe("single_fix")
    expect(d.qualifyingFixes).toBe(1)
  })

  test("never on a single fix even when it is hours old", () => {
    const d = evaluateGeofenceAutoSignout({ shiftOpen: true, fixes: [fix(-300, false, 5)], now })
    expect(d.signOut).toBe(false)
    expect(d.reason).toBe("single_fix")
  })

  test("fires after 10 continuous minutes outside with good accuracy", () => {
    const d = evaluateGeofenceAutoSignout({
      shiftOpen: true,
      fixes: [fix(0, true, 8), fix(5, false, 20), fix(15, false, 25)],
      now,
    })
    expect(d.signOut).toBe(true)
    expect(d.reason).toBe("outside_geofence_dwell")
    expect(d.dwellMinutes).toBe(10)
    expect(d.qualifyingFixes).toBe(2)
    // Signed out at the moment they were first seen off site, not at detection.
    expect(d.outsideSince).toBe(fix(5, false, 20).logged_at)
  })

  test("does not fire at nine minutes", () => {
    const d = evaluateGeofenceAutoSignout({
      shiftOpen: true,
      fixes: [fix(0, false, 20), fix(9, false, 20)],
      now,
    })
    expect(d.signOut).toBe(false)
    expect(d.reason).toBe("dwell_too_short")
    expect(d.dwellMinutes).toBe(9)
  })

  test("accuracy of exactly 100m is not under 100m", () => {
    const d = evaluateGeofenceAutoSignout({
      shiftOpen: true,
      fixes: [fix(0, false, GEOFENCE_ACCURACY_LIMIT_M), fix(30, false, 10)],
      now,
    })
    expect(d.signOut).toBe(false)
    expect(d.reason).toBe("accuracy_too_coarse")
  })

  test("an unknown accuracy is unusable, not perfect", () => {
    // The geofence-exit breadcrumb used to be written with accuracy 0, which
    // under this rule would have been the single most trustworthy fix in the
    // trail. It is null now, and null does not count.
    const d = evaluateGeofenceAutoSignout({
      shiftOpen: true,
      fixes: [fix(0, false, null), fix(30, false, 10)],
      now,
    })
    expect(d.signOut).toBe(false)
    expect(d.reason).toBe("accuracy_unknown")
  })

  test("coming back on site resets the clock", () => {
    const d = evaluateGeofenceAutoSignout({
      shiftOpen: true,
      fixes: [fix(0, false, 10), fix(20, false, 10), fix(25, true, 10), fix(30, false, 10)],
      now,
    })
    expect(d.signOut).toBe(false)
    expect(d.reason).toBe("single_fix")
  })

  test("the last fix being inside the fence is never a sign-out", () => {
    const d = evaluateGeofenceAutoSignout({
      shiftOpen: true,
      fixes: [fix(0, false, 10), fix(30, false, 10), fix(40, true, 10)],
      now,
    })
    expect(d.signOut).toBe(false)
    expect(d.reason).toBe("last_fix_inside_geofence")
  })

  test("no fixes at all is never a sign-out", () => {
    const d = evaluateGeofenceAutoSignout({ shiftOpen: true, fixes: [], now })
    expect(d.signOut).toBe(false)
    expect(d.reason).toBe("no_location_fixes")
  })

  test("fixes in any order give the same answer", () => {
    const ordered = [fix(0, true, 8), fix(5, false, 20), fix(40, false, 25)]
    const shuffled = [ordered[2], ordered[0], ordered[1]]
    const a = evaluateGeofenceAutoSignout({ shiftOpen: true, fixes: ordered, now })
    const b = evaluateGeofenceAutoSignout({ shiftOpen: true, fixes: shuffled, now })
    expect(b).toEqual(a)
    expect(a.signOut).toBe(true)
  })

  test("the thresholds are the ones the rule names", () => {
    expect(GEOFENCE_DWELL_MINUTES).toBe(10)
    expect(GEOFENCE_ACCURACY_LIMIT_M).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// The incident itself, end to end through the rules
// ---------------------------------------------------------------------------

test.describe("regression: the Saturday push storm", () => {
  // Saturday 2026-09-12. Not signed in, not on site, not scheduled. The shift
  // that generated the pushes was a Friday one left open because the close was
  // being rejected by the database.
  test("nothing may be pushed to an unscheduled worker on a Saturday", () => {
    for (const hhmm of ["06:00", "07:50", "08:00", "12:00", "18:30"]) {
      const gate = isPushAllowed({
        minutesOfDay: at(hhmm),
        dayIndex: SAT,
        scheduledToday: false,
        quiet: QUIET,
      })
      expect(gate.allowed, `${hhmm} on a Saturday`).toBe(false)
    }
  })

  test("the stale Friday shift cannot be signed out on location evidence", () => {
    // Its only fixes are in range, from Friday. Under the new rule that is not
    // a sign-out, and under the old one no location rule ran here at all.
    const d = evaluateGeofenceAutoSignout({
      shiftOpen: true,
      fixes: [
        { logged_at: "2026-09-11T06:37:55Z", within_range: true, accuracy_metres: 6 },
        { logged_at: "2026-09-11T09:49:50Z", within_range: true, accuracy_metres: 100 },
      ],
      now: new Date("2026-09-12T07:30:00Z"),
    })
    expect(d.signOut).toBe(false)
    expect(d.reason).toBe("last_fix_inside_geofence")
  })
})
