import { test, expect } from "@playwright/test"
import { attendanceCells, elapsedHours } from "../../lib/audit/attendance"

/**
 * The attendance table is the first thing anybody reads in an evidence pack,
 * and it is read by somebody deciding whether to pay. A blank where a figure
 * belongs makes the whole row look unreliable, so there is no blank.
 */

const fmt = (v: string) => `formatted:${v}`

test("a closed shift prints its hours", () => {
  const cells = attendanceCells(
    { signed_in_at: "2026-09-15T06:52:00Z", signed_out_at: "2026-09-15T15:34:00Z", hours_worked: 8.7 },
    fmt,
  )
  expect(cells).toEqual({ signedOut: "formatted:2026-09-15T15:34:00Z", hours: "8.7h", inProgress: false })
})

test("a shift still running says so, in both columns", () => {
  const cells = attendanceCells({ signed_in_at: "2026-09-20T07:48:00Z", signed_out_at: null, hours_worked: null }, fmt)
  expect(cells.signedOut).toBe("In progress")
  expect(cells.hours).toBe("In progress")
  expect(cells.inProgress).toBe(true)
})

test("a real but tiny shift says how tiny, never a dash", () => {
  // One second. It rounds to 0.0h, which reads as "nothing happened".
  const cells = attendanceCells(
    { signed_in_at: "2026-09-20T11:33:07Z", signed_out_at: "2026-09-20T11:33:08Z", hours_worked: 0 },
    fmt,
  )
  expect(cells.hours).toBe("under 0.1h")
  expect(cells.inProgress).toBe(false)
})

test("stored hours win over the clock, but a stored zero does not", () => {
  // Payroll may legitimately correct a timesheet, so the stored value leads.
  const corrected = attendanceCells(
    { signed_in_at: "2026-09-15T07:00:00Z", signed_out_at: "2026-09-15T17:00:00Z", hours_worked: 8 },
    fmt,
  )
  expect(corrected.hours).toBe("8.0h")

  // A stored zero on a shift that plainly ran is a missing value, not a
  // correction: fall back to the stamps rather than printing nothing.
  const zeroed = attendanceCells(
    { signed_in_at: "2026-09-15T07:00:00Z", signed_out_at: "2026-09-15T16:00:00Z", hours_worked: 0 },
    fmt,
  )
  expect(zeroed.hours).toBe("9.0h")
})

test("unreadable stamps say 'Not recorded' rather than guessing", () => {
  const cells = attendanceCells({ signed_in_at: "not a date", signed_out_at: "also not", hours_worked: null }, fmt)
  expect(cells.hours).toBe("Not recorded")
})

test("elapsed hours refuses a negative span", () => {
  expect(elapsedHours({ signed_in_at: "2026-09-15T17:00:00Z", signed_out_at: "2026-09-15T07:00:00Z" })).toBeNull()
  expect(elapsedHours({ signed_in_at: "2026-09-15T07:00:00Z", signed_out_at: null })).toBeNull()
  expect(elapsedHours({ signed_in_at: "2026-09-15T07:00:00Z", signed_out_at: "2026-09-15T08:30:00Z" })).toBeCloseTo(1.5, 6)
})
