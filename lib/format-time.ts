// lib/format-time.ts
//
// The one place a date becomes text.
//
// Why this exists: a client component that renders on the server formats the
// same instant twice -- once in Node on Vercel and once in the browser -- and
// React compares the two strings. Anything left to the environment differs
// between them:
//
//   - locale. `toLocaleTimeString([])` took the SERVER's locale on the server
//     and the BROWSER's on the client, so a UK admin on a US-English browser
//     got "17:20" from the server and "05:20 PM" back from React. That is the
//     hydration mismatch reported on /admin (Sentry 14b5477825cf4150b698b6f32b5732d6).
//   - time zone. Vercel's runtime is UTC. A call that named the locale but not
//     the zone still rendered 17:20 as "17:20" server-side and "18:20" in a
//     British browser every summer. Same class of bug, only visible for half
//     the year, which is worse.
//
// So both are pinned here and nowhere else. Vantro is a UK product billing UK
// payroll hours: a shift is what the clock on the site said, so Europe/London
// is the correct zone for every reader, including an admin checking timesheets
// from abroad.

export const LOCALE = "en-GB"
export const TIME_ZONE = "Europe/London"

export type DateLike = Date | string | number | null | undefined

/** What a missing or unparseable date renders as. An em dash, never "Invalid Date". */
export const NO_DATE = "—"

// Intl.DateTimeFormat construction is the expensive part, so formatters are
// built once per option shape and reused. The key is the option object in
// insertion order, which is stable because every call site passes a literal.
const cache = new Map<string, Intl.DateTimeFormat>()

function formatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(options)
  let f = cache.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(LOCALE, { ...options, timeZone: TIME_ZONE })
    cache.set(key, f)
  }
  return f
}

function toDate(value: DateLike): Date | null {
  if (value == null) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Format with explicit options, in the fixed locale and zone.
 *
 * The general escape hatch: pass the same options object the old
 * toLocaleDateString / toLocaleString call used and the output is unchanged
 * except that it no longer depends on where the code ran.
 */
export function formatIn(value: DateLike, options: Intl.DateTimeFormatOptions): string {
  const d = toDate(value)
  return d ? formatter(options).format(d) : NO_DATE
}

/** 17:20. Always 24 hour, which is how a timesheet is read. */
export function formatTime(value: DateLike): string {
  return formatIn(value, { hour: "2-digit", minute: "2-digit", hour12: false })
}

/** 10/09/2026. Matches a bare toLocaleDateString("en-GB"). */
export function formatDate(value: DateLike): string {
  return formatIn(value, { day: "2-digit", month: "2-digit", year: "numeric" })
}

/** 10 Sep. */
export function formatDayMonth(value: DateLike): string {
  return formatIn(value, { day: "numeric", month: "short" })
}

/** 10 Sep 2026. */
export function formatDateLong(value: DateLike): string {
  return formatIn(value, { day: "2-digit", month: "short", year: "numeric" })
}

/** 10/09/2026, 17:20:15. Matches a bare toLocaleString("en-GB"). */
export function formatDateTime(value: DateLike): string {
  return formatIn(value, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
}

/** 10 Sep, 17:20. The short stamp used down the activity and alert lists. */
export function formatDateTimeShort(value: DateLike): string {
  return formatIn(value, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

/** 10 Sep 2026, 17:20. */
export function formatDateTimeLong(value: DateLike): string {
  return formatIn(value, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

// ---------------------------------------------------------------------------
// Week boundaries.
//
// A payroll week is a wall-clock week in Europe/London, not a UTC week. Under
// BST, London midnight is 23:00 UTC the day before, so a naive
// `new Date(weekStart + "T00:00:00Z")` silently pulls an hour of Sunday-evening
// work into the wrong week for half the year -- and the week a shift lands in
// decides which timesheet it is paid on.
// ---------------------------------------------------------------------------

/** How far Europe/London is ahead of UTC, in minutes, at a given instant. */
function londonOffsetMinutes(at: Date): number {
  const parts = Object.fromEntries(
    formatter({
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>
  const asIfUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
  )
  return (asIfUTC - at.getTime()) / 60000
}

/**
 * The instant at which a given London calendar day begins.
 *
 * DST in the UK switches at 01:00, never at midnight, so reading the offset at
 * the UTC guess and subtracting it lands on the right instant without needing
 * a second pass.
 */
export function londonMidnight(dateOnly: string): Date {
  const guess = new Date(`${dateOnly}T00:00:00Z`)
  if (Number.isNaN(guess.getTime())) throw new Error(`invalid date: ${dateOnly}`)
  return new Date(guess.getTime() - londonOffsetMinutes(guess) * 60000)
}

/** "2026-09-11" for a Date, as London sees the calendar. */
export function londonDateOnly(value: DateLike): string {
  const d = toDate(value)
  if (!d) return ""
  const parts = Object.fromEntries(
    formatter({ year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>
  return `${parts.year}-${parts.month}-${parts.day}`
}

/**
 * The Monday of the London week containing `value`, as "YYYY-MM-DD".
 *
 * Monday because that is the week ISO-8601 and UK payroll both use; taking
 * Sunday would move every Sunday shift into the previous week's timesheet.
 */
export function isoWeekStart(value: DateLike): string {
  const dateOnly = londonDateOnly(value)
  if (!dateOnly) throw new Error("invalid date for week start")
  const weekdayName = formatIn(londonMidnight(dateOnly), { weekday: "short" })
  const index = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(weekdayName)
  if (index < 0) throw new Error(`unrecognised weekday: ${weekdayName}`)
  const monday = new Date(londonMidnight(dateOnly).getTime())
  monday.setUTCDate(monday.getUTCDate() - index)
  return londonDateOnly(monday)
}

/** Add whole London days to a "YYYY-MM-DD", returning "YYYY-MM-DD". */
export function addDays(dateOnly: string, days: number): string {
  const d = londonMidnight(dateOnly)
  d.setUTCDate(d.getUTCDate() + days)
  return londonDateOnly(d)
}
