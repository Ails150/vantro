import { test, expect } from "@playwright/test"
import {
  NO_PAY_RULES,
  latenessFor,
  payableHours,
  scheduledStartFor,
  toPayRules,
} from "../../lib/pay"

/**
 * Lateness is the one number here a worker will be confronted with, so the
 * boundaries favour the person and the rule that it never touches pay is
 * asserted rather than assumed.
 */

test.describe("lateness never changes pay", () => {
  test("the grace setting has no effect on payable hours", () => {
    const withLateness = { ...NO_PAY_RULES, latenessGraceMinutes: 0 }
    for (const h of [0.5, 7.5, 9, 12]) {
      expect(payableHours(h, withLateness)).toBe(payableHours(h, NO_PAY_RULES))
    }
  })
})

test.describe("latenessFor", () => {
  test("reporting off means never late, whatever the clock says", () => {
    expect(latenessFor("09:45", "08:00", null)).toEqual({
      isLate: false, minutesLate: 0, hasSchedule: false,
    })
    expect(latenessFor("09:45", "08:00", undefined).isLate).toBe(false)
  })

  test("late past the grace", () => {
    const r = latenessFor("08:25", "08:00", 10)
    expect(r.isLate).toBe(true)
    expect(r.minutesLate).toBe(25)
    expect(r.hasSchedule).toBe(true)
  })

  test("the grace boundary favours the worker", () => {
    // Exactly on the allowance is on time.
    expect(latenessFor("08:10", "08:00", 10).isLate).toBe(false)
    expect(latenessFor("08:11", "08:00", 10).isLate).toBe(true)
  })

  test("zero grace reports a single minute", () => {
    expect(latenessFor("08:01", "08:00", 0).isLate).toBe(true)
    expect(latenessFor("08:00", "08:00", 0).isLate).toBe(false)
  })

  test("early is not negative lateness", () => {
    // Netting early days off against late ones is not how attendance works.
    const r = latenessFor("07:42", "08:00", 10)
    expect(r.isLate).toBe(false)
    expect(r.minutesLate).toBe(0)
    expect(r.hasSchedule).toBe(true)
  })

  test("minutesLate is the real figure even inside the grace", () => {
    // The supervisor may want to see a pattern of eight-minute arrivals even
    // though none of them is reportable.
    const r = latenessFor("08:08", "08:00", 10)
    expect(r.isLate).toBe(false)
    expect(r.minutesLate).toBe(8)
  })

  test("no schedule means nothing to judge against", () => {
    expect(latenessFor("08:25", null, 10)).toEqual({
      isLate: false, minutesLate: 0, hasSchedule: false,
    })
    expect(latenessFor(null, "08:00", 10).hasSchedule).toBe(false)
  })

  test("seconds are accepted and ignored", () => {
    expect(latenessFor("08:25:44", "08:00:00", 10).minutesLate).toBe(25)
  })

  test("garbage is not late rather than a crash", () => {
    for (const bad of ["", "half eight", "25:00", "08:70", "8", "--"]) {
      expect(latenessFor(bad, "08:00", 0).hasSchedule).toBe(false)
      expect(latenessFor("08:30", bad, 0).hasSchedule).toBe(false)
    }
  })

  test("a single digit hour is read", () => {
    expect(latenessFor("8:30", "8:00", 10).minutesLate).toBe(30)
  })

  test("an overnight start is not mistaken for a wildly late arrival", () => {
    // Both sides are wall clock on the same local day, so a 22:00 start with a
    // 22:05 arrival is five minutes, not a day.
    expect(latenessFor("22:05", "22:00", 0).minutesLate).toBe(5)
  })
})

test.describe("scheduledStartFor precedence", () => {
  test("the job wins", () => {
    expect(scheduledStartFor("06:00", "08:00", "07:30")).toBe("06:00")
  })

  test("then the worker", () => {
    expect(scheduledStartFor(null, "08:00", "07:30")).toBe("08:00")
  })

  test("then the company", () => {
    expect(scheduledStartFor(null, null, "07:30")).toBe("07:30")
  })

  test("nothing set is null, not a guess", () => {
    expect(scheduledStartFor(null, null, null)).toBeNull()
    expect(scheduledStartFor("", "", "")).toBeNull()
  })
})

test.describe("toPayRules reads the lateness column", () => {
  test("maps it", () => {
    expect(toPayRules({ lateness_grace_minutes: 10 }).latenessGraceMinutes).toBe(10)
  })
  test("zero survives and is not treated as absent", () => {
    expect(toPayRules({ lateness_grace_minutes: 0 }).latenessGraceMinutes).toBe(0)
  })
  test("absent stays null", () => {
    expect(toPayRules({}).latenessGraceMinutes).toBeNull()
  })
})
