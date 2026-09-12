// lib/notifications/rules.ts
//
// Every "should this push go out?" decision, as pure functions.
//
// The notification engine used to make these decisions inline, mixed in with
// Supabase calls, which meant none of them could be tested and two of them were
// wrong in ways that only showed up as a phone buzzing on a Saturday. Everything
// here takes plain values and returns a decision plus the reason for it. The
// reason is not decoration: it is written to notification_log so the next time
// someone asks "why did my phone do that", the answer is a query rather than an
// archaeology session.
//
// Nothing in this file touches the network, the clock, or the database. The
// caller resolves "now" in the company's timezone and passes it in.

export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const
export type DayKey = (typeof DAY_KEYS)[number]

/** Minutes since local midnight, from "HH:MM" or "HH:MM:SS". */
export function parseHhmm(value: string | null | undefined): number | null {
  if (!value) return null
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value).trim())
  if (!m) return null
  const h = Number(m[1])
  const mi = Number(m[2])
  if (!Number.isFinite(h) || !Number.isFinite(mi)) return null
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null
  return h * 60 + mi
}

// ---------------------------------------------------------------------------
// Quiet hours (rule 5)
// ---------------------------------------------------------------------------

export type QuietHours = {
  /** "HH:MM" local. Pushes are suppressed from here... */
  start: string
  /** ..."HH:MM" local, exclusive. Wraps past midnight when end <= start. */
  end: string
  /** When false, Saturday and Sunday are silent unless the worker is scheduled. */
  weekendPush: boolean
}

export const DEFAULT_QUIET_HOURS: QuietHours = {
  start: "19:00",
  end: "06:00",
  weekendPush: false,
}

/**
 * Is `minutesOfDay` inside the quiet window?
 *
 * The window normally wraps midnight (19:00 -> 06:00), so this is a union of
 * two ranges rather than one comparison. start === end means a full 24 hours
 * of quiet, which is a legitimate way for a company to mute pushes entirely;
 * it is not treated as "no quiet hours".
 */
export function isQuietHour(minutesOfDay: number, quiet: QuietHours): boolean {
  const start = parseHhmm(quiet.start)
  const end = parseHhmm(quiet.end)
  if (start == null || end == null) return false
  if (start === end) return true
  if (start < end) return minutesOfDay >= start && minutesOfDay < end
  return minutesOfDay >= start || minutesOfDay < end
}

export function isWeekend(dayIndex: number): boolean {
  return dayIndex === 0 || dayIndex === 6
}

export type PushGate = { allowed: boolean; reason: string }

/**
 * The gate every outbound push passes through, whatever kind it is.
 *
 * `scheduledToday` is the worker's own schedule for this local date. A worker
 * rostered on for a Saturday still gets their pushes -- that is the "unless
 * scheduled" half of the rule, and without it the weekend block would break
 * every weekend shift on the platform.
 */
export function isPushAllowed(input: {
  minutesOfDay: number
  dayIndex: number
  scheduledToday: boolean
  quiet: QuietHours
}): PushGate {
  const { minutesOfDay, dayIndex, scheduledToday, quiet } = input

  if (isWeekend(dayIndex) && !scheduledToday && !quiet.weekendPush) {
    return { allowed: false, reason: "weekend_not_scheduled" }
  }
  if (isQuietHour(minutesOfDay, quiet)) {
    return { allowed: false, reason: "quiet_hours" }
  }
  return { allowed: true, reason: "allowed" }
}

// ---------------------------------------------------------------------------
// Which days is this worker working? (rules 3 and 5)
// ---------------------------------------------------------------------------

export type ScheduleSources = {
  /** user_shifts rows for this day_of_week that are in force on this date. */
  shifts?: Array<{ start_time: string; end_time: string }> | null
  /** users.weekly_schedule: { mon: { working, sign_in, sign_out }, ... } */
  weeklySchedule?: Record<
    string,
    { working?: boolean; sign_in?: string | null; sign_out?: string | null }
  > | null
  /** users.working_days: ["mon","tue",...] */
  workingDays?: string[] | null
  /** companies.default_schedule: { mon: { enabled, start, end }, ... } */
  companyDefault?: Record<
    string,
    { enabled?: boolean; start?: string | null; end?: string | null }
  > | null
}

export type ScheduledDay = {
  scheduled: boolean
  /** Local "HH:MM" the worker is due on, when the schedule names one. */
  startTime: string | null
  endTime: string | null
  source: "user_shift" | "weekly_schedule" | "working_days" | "company_default" | "none"
}

/**
 * Resolve whether the worker is rostered on `dayIndex`, most specific source
 * first. The old resolver consulted user_shifts and the company default and
 * skipped users.weekly_schedule entirely -- which is the field the admin UI
 * actually writes, and the one that says this worker does not work weekends.
 */
export function resolveScheduledDay(dayIndex: number, sources: ScheduleSources): ScheduledDay {
  const dayKey = DAY_KEYS[dayIndex]

  const shifts = sources.shifts ?? []
  if (shifts.length > 0) {
    const primary = shifts[0]
    return {
      scheduled: true,
      startTime: (primary.start_time || "").slice(0, 5) || null,
      endTime: (primary.end_time || "").slice(0, 5) || null,
      source: "user_shift",
    }
  }

  const weekly = sources.weeklySchedule?.[dayKey]
  if (weekly && typeof weekly.working === "boolean") {
    return {
      scheduled: weekly.working,
      startTime: weekly.working ? weekly.sign_in ?? null : null,
      endTime: weekly.working ? weekly.sign_out ?? null : null,
      source: "weekly_schedule",
    }
  }

  const workingDays = sources.workingDays
  if (Array.isArray(workingDays) && workingDays.length > 0) {
    return {
      scheduled: workingDays.includes(dayKey),
      startTime: null,
      endTime: null,
      source: "working_days",
    }
  }

  const companyDay = sources.companyDefault?.[dayKey]
  if (companyDay) {
    return {
      scheduled: !!companyDay.enabled,
      startTime: companyDay.enabled ? companyDay.start ?? null : null,
      endTime: companyDay.enabled ? companyDay.end ?? null : null,
      source: "company_default",
    }
  }

  // No schedule anywhere. Not scheduled: silence is the safe default, and a
  // worker with no roster has nothing to be reminded about.
  return { scheduled: false, startTime: null, endTime: null, source: "none" }
}

// ---------------------------------------------------------------------------
// Is this job allowed to generate notifications at all? (rule 4)
// ---------------------------------------------------------------------------

export type NotifiableJob = {
  id: string
  status?: string | null
  archived_at?: string | null
  completed_at?: string | null
  start_date?: string | null
  end_date?: string | null
}

/**
 * A job that is archived, completed, or outside its own date range must not
 * produce a push, whatever the schedule says. `localDateStr` is the
 * company-local date, so a job that ended yesterday goes quiet at local
 * midnight rather than at UTC midnight.
 */
export function isJobNotifiable(job: NotifiableJob, localDateStr: string): PushGate {
  if (job.archived_at) return { allowed: false, reason: "job_archived" }
  if (job.completed_at) return { allowed: false, reason: "job_completed" }
  const status = (job.status || "").toLowerCase()
  if (status && status !== "active") return { allowed: false, reason: `job_status_${status}` }
  if (job.start_date && localDateStr < job.start_date) {
    return { allowed: false, reason: "job_not_started" }
  }
  if (job.end_date && localDateStr > job.end_date) {
    return { allowed: false, reason: "job_ended" }
  }
  return { allowed: true, reason: "allowed" }
}

// ---------------------------------------------------------------------------
// Sign-in reminders (rule 3)
// ---------------------------------------------------------------------------

/** Reminder window, relative to the shift start, in minutes. */
export const SIGNIN_REMINDER_EARLIEST = -15
export const SIGNIN_REMINDER_LATEST = 30

export type SigninReminderInput = {
  /** Company-local minutes since midnight. */
  minutesOfDay: number
  /** Company-local day index, 0 = Sunday. */
  dayIndex: number
  localDateStr: string
  /** The shift start this reminder is about, "HH:MM" local. */
  shiftStart: string | null
  scheduled: boolean
  /** True if the worker has ANY open sign-in, on any job. */
  alreadySignedIn: boolean
  /** True if a reminder for this exact shift has already been sent. */
  alreadyReminded: boolean
  hasPushToken: boolean
  /** Time off / public holiday / anything else that mutes the worker. */
  protectedReason?: string | null
  job: NotifiableJob
  quiet: QuietHours
}

export type SigninReminderDecision = {
  send: boolean
  reason: string
  /** Signed minutes from the shift start; negative means the shift is ahead. */
  minutesFromStart: number | null
}

/**
 * "Only on days the worker is scheduled, only between shift start minus 15 and
 * shift start plus 30, never on weekends unless the schedule says so, never if
 * already signed in, once per shift not repeated."
 *
 * The checks are ordered most-decisive first so the logged reason is the one a
 * human would give. Being signed in already beats being outside the window:
 * "you were on site" is a better answer than "it was 11am".
 */
export function shouldSendSigninReminder(input: SigninReminderInput): SigninReminderDecision {
  const jobGate = isJobNotifiable(input.job, input.localDateStr)
  if (!jobGate.allowed) return { send: false, reason: jobGate.reason, minutesFromStart: null }

  if (!input.hasPushToken) return { send: false, reason: "no_push_token", minutesFromStart: null }
  if (input.alreadySignedIn) return { send: false, reason: "already_signed_in", minutesFromStart: null }
  if (input.alreadyReminded) return { send: false, reason: "already_reminded", minutesFromStart: null }
  if (input.protectedReason) return { send: false, reason: input.protectedReason, minutesFromStart: null }
  if (!input.scheduled) return { send: false, reason: "not_scheduled_today", minutesFromStart: null }

  const start = parseHhmm(input.shiftStart)
  if (start == null) return { send: false, reason: "no_shift_start", minutesFromStart: null }

  const minutesFromStart = input.minutesOfDay - start
  if (minutesFromStart < SIGNIN_REMINDER_EARLIEST || minutesFromStart > SIGNIN_REMINDER_LATEST) {
    return { send: false, reason: "outside_reminder_window", minutesFromStart }
  }

  const gate = isPushAllowed({
    minutesOfDay: input.minutesOfDay,
    dayIndex: input.dayIndex,
    scheduledToday: input.scheduled,
    quiet: input.quiet,
  })
  if (!gate.allowed) return { send: false, reason: gate.reason, minutesFromStart }

  return { send: true, reason: "in_window", minutesFromStart }
}

// ---------------------------------------------------------------------------
// Geofence auto sign-out (rule 2)
// ---------------------------------------------------------------------------

export const GEOFENCE_DWELL_MINUTES = 10
export const GEOFENCE_ACCURACY_LIMIT_M = 100

export type LocationFix = {
  logged_at: string
  within_range: boolean | null
  accuracy_metres: number | null
}

export type GeofenceDecision = {
  signOut: boolean
  reason: string
  /** The instant they were first observed outside, which is the sign-out time. */
  outsideSince: string | null
  /** How long the qualifying run of outside fixes spans, in minutes. */
  dwellMinutes: number
  /** How many fixes support the decision. Never 1 -- see below. */
  qualifyingFixes: number
}

/**
 * Decide whether an open shift should be auto signed out on location evidence.
 *
 * The bar is deliberately high, because the failure mode is docking someone's
 * pay for a shift they actually worked:
 *
 *   - there is an open shift
 *   - at least two fixes, so a single bad reading can never do it
 *   - every fix in the run is outside the geofence
 *   - every fix in the run has a known accuracy better than 100m; a fix with
 *     null accuracy is unknown, not good, and does not count
 *   - the run spans at least 10 continuous minutes
 *   - no in-range fix interrupts the run
 *
 * `fixes` may be in any order; they are sorted oldest-first here. The run is
 * taken from the most recent in-range fix onward, so coming back on site
 * resets the clock.
 */
export function evaluateGeofenceAutoSignout(input: {
  shiftOpen: boolean
  fixes: LocationFix[]
  dwellMinutes?: number
  accuracyLimitMetres?: number
  now: Date
}): GeofenceDecision {
  const dwell = input.dwellMinutes ?? GEOFENCE_DWELL_MINUTES
  const limit = input.accuracyLimitMetres ?? GEOFENCE_ACCURACY_LIMIT_M
  const none: GeofenceDecision = {
    signOut: false,
    reason: "no_open_shift",
    outsideSince: null,
    dwellMinutes: 0,
    qualifyingFixes: 0,
  }

  if (!input.shiftOpen) return none

  const fixes = [...(input.fixes || [])].sort(
    (a, b) => new Date(a.logged_at).getTime() - new Date(b.logged_at).getTime(),
  )
  if (fixes.length === 0) {
    return { ...none, reason: "no_location_fixes" }
  }

  // Everything after the last time they were seen inside the fence.
  let runStart = 0
  for (let i = fixes.length - 1; i >= 0; i--) {
    if (fixes[i].within_range === true) {
      runStart = i + 1
      break
    }
  }
  const run = fixes.slice(runStart)
  if (run.length === 0) {
    return { ...none, reason: "last_fix_inside_geofence" }
  }

  // A fix we cannot trust breaks the run rather than being skipped over: an
  // unknown-accuracy reading is exactly the case where "they left site" and
  // "the phone guessed" are indistinguishable.
  const unusable = run.find(f => f.accuracy_metres == null || !(f.accuracy_metres < limit))
  if (unusable) {
    return {
      signOut: false,
      reason: unusable.accuracy_metres == null ? "accuracy_unknown" : "accuracy_too_coarse",
      outsideSince: null,
      dwellMinutes: 0,
      qualifyingFixes: 0,
    }
  }

  if (run.length < 2) {
    return {
      signOut: false,
      reason: "single_fix",
      outsideSince: run[0].logged_at,
      dwellMinutes: 0,
      qualifyingFixes: 1,
    }
  }

  const first = new Date(run[0].logged_at).getTime()
  const last = new Date(run[run.length - 1].logged_at).getTime()
  const spanMinutes = Math.floor((last - first) / 60000)

  if (spanMinutes < dwell) {
    return {
      signOut: false,
      reason: "dwell_too_short",
      outsideSince: run[0].logged_at,
      dwellMinutes: spanMinutes,
      qualifyingFixes: run.length,
    }
  }

  return {
    signOut: true,
    reason: "outside_geofence_dwell",
    outsideSince: run[0].logged_at,
    dwellMinutes: spanMinutes,
    qualifyingFixes: run.length,
  }
}
