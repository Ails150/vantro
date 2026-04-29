// Timezone-aware time helpers used by the notifications cron and debug endpoint.
//
// Replaces the previous UK-hardcoded `isBST()` + `(utcHour + ukOffset) % 24` math.
// Every helper here takes an IANA timezone string ("Europe/London", "Europe/Madrid",
// "America/New_York", etc) and uses Intl.DateTimeFormat to compute the wall-clock
// time in that zone. That handles DST, half-hour zones, and edge cases without
// any custom offset tables.

const DEFAULT_TZ = "Europe/London"

export type LocalNow = {
  tz: string
  /** 0-23 in the company's local timezone */
  hour: number
  /** 0-59 in the company's local timezone */
  minute: number
  /** YYYY-MM-DD in the company's local timezone */
  dateStr: string
  /** Local minutes since midnight (hour*60 + minute) */
  minutesOfDay: number
  /** UTC instant the local "today midnight" corresponds to (for date-bounded queries) */
  todayUtcMidnight: Date
}

/**
 * Compute the local wall-clock time + date in a given IANA timezone.
 * Falls back to Europe/London if `tz` is null/empty/invalid.
 */
export function nowInTimezone(tz: string | null | undefined, when: Date = new Date()): LocalNow {
  const zone = tz && tz.length > 0 ? tz : DEFAULT_TZ
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(when)
  } catch {
    // Invalid IANA zone â†’ fall back to London
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: DEFAULT_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(when)
  }

  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "00"
  const yyyy = get("year")
  const mm = get("month")
  const dd = get("day")
  let hour = parseInt(get("hour"), 10)
  const minute = parseInt(get("minute"), 10)
  // Intl can return "24" for midnight in some locales â€” normalise.
  if (hour === 24) hour = 0

  const dateStr = `${yyyy}-${mm}-${dd}`
  const minutesOfDay = hour * 60 + minute
  const todayUtcMidnight = localMidnightToUtc(dateStr, zone)

  return { tz: zone, hour, minute, dateStr, minutesOfDay, todayUtcMidnight }
}

/**
 * Given a date string "YYYY-MM-DD" interpreted as a local date in `tz`,
 * return the UTC instant that corresponds to local midnight.
 *
 * Used to bound queries like "sign-ins from today onwards" correctly across
 * timezones without assuming UK boundaries.
 */
export function localMidnightToUtc(dateStr: string, tz: string): Date {
  // Strategy: pick a candidate UTC instant at the start of that calendar day
  // (in UTC), measure the offset between UTC and the target tz at that moment,
  // and shift by the offset. Re-measure once to handle DST transition days.
  const [y, m, d] = dateStr.split("-").map(Number)
  const candidate = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0))
  const offsetMin1 = getTzOffsetMinutes(candidate, tz)
  const adjusted = new Date(candidate.getTime() - offsetMin1 * 60000)
  // Re-measure offset at the adjusted instant in case DST shifted underneath us
  const offsetMin2 = getTzOffsetMinutes(adjusted, tz)
  if (offsetMin2 !== offsetMin1) {
    return new Date(candidate.getTime() - offsetMin2 * 60000)
  }
  return adjusted
}

/**
 * Return the offset (in minutes) between UTC and `tz` at the given instant.
 * Positive for zones east of UTC (e.g. Europe/London = +60 in summer, 0 in winter).
 */
export function getTzOffsetMinutes(when: Date, tz: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(when)
    const get = (t: string) => parseInt(parts.find(p => p.type === t)?.value ?? "0", 10)
    const localAsUtcMs = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour") === 24 ? 0 : get("hour"),
      get("minute"),
      get("second"),
    )
    return Math.round((localAsUtcMs - when.getTime()) / 60000)
  } catch {
    return 0
  }
}

/**
 * Combine a sign-in's calendar date (in `tz`) with an "HH:MM" wall-clock time
 * (also in `tz`) to produce the actual UTC instant that wall-clock represents.
 *
 * Example: signedInAt = 2026-04-29T07:00Z, expected_sign_out_time = "17:00",
 *          tz = "Europe/London"
 *   â†’ London local date is 2026-04-29 (BST, UTC+1)
 *   â†’ 17:00 London on 2026-04-29 = 16:00 UTC
 *   â†’ returns Date(2026-04-29T16:00:00Z)
 */
export function combineDateAndLocalTime(
  signedInAt: string,
  hhmm: string,
  tz: string,
): Date {
  const localDateStr = nowInTimezone(tz, new Date(signedInAt)).dateStr
  const [y, m, d] = localDateStr.split("-").map(Number)
  const [h, mi] = hhmm.split(":").map(Number)
  // UTC instant naively assuming the wall-clock is UTC
  const naiveUtcMs = Date.UTC(y, m - 1, d, h, mi, 0, 0)
  // Shift back by the tz offset at that moment
  const candidate = new Date(naiveUtcMs)
  const offsetMin = getTzOffsetMinutes(candidate, tz)
  let actual = new Date(naiveUtcMs - offsetMin * 60000)
  // Re-check across DST boundary
  const offsetMin2 = getTzOffsetMinutes(actual, tz)
  if (offsetMin2 !== offsetMin) {
    actual = new Date(naiveUtcMs - offsetMin2 * 60000)
  }
  return actual
}
