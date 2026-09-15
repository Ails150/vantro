import { test, expect } from "@playwright/test"
import {
  RETENTION_REMINDER_DAYS,
  claimDueDate,
  daysBetween,
  formatMoney,
  isOutstanding,
  needsAttention,
  retentionFor,
  retentionHeld,
} from "../../lib/retention"

/**
 * These numbers go on a letter asking a client for money. Every one of them is
 * either right or an embarrassment, so the arithmetic is pinned here rather
 * than trusted to look correct on a screen.
 */

test.describe("retention held: pence, not floats", () => {
  test("the ordinary case", () => {
    expect(retentionHeld(48000, 5)).toBe(2400)
    expect(retentionHeld(125000, 3)).toBe(3750)
  })

  test("the float that would otherwise reach the letter", () => {
    // 48000 * 0.05 in binary floating point is 2400.0000000000005.
    expect(String(retentionHeld(48000, 5))).toBe("2400")
    const held = retentionHeld(8150.7, 5)
    expect(held).toBe(407.54)
    expect(String(held)).toBe("407.54")
  })

  test("two decimal places of percentage survive", () => {
    expect(retentionHeld(100000, 5.25)).toBe(5250)
    expect(retentionHeld(64750, 2.5)).toBe(1618.75)
  })

  test("rounds to the penny, half up", () => {
    // 333.33 * 1.5% = 4.99995 -> 5.00
    expect(retentionHeld(333.33, 1.5)).toBe(5)
  })

  test("missing or nonsense inputs are zero, not a crash", () => {
    const cases: any[] = [
      [null, 5], [48000, null], [undefined, undefined],
      [0, 5], [48000, 0], [-1000, 5], [48000, -5],
      [NaN, 5], [48000, NaN], ["", 5],
    ]
    for (const [v, p] of cases) expect(retentionHeld(v, p)).toBe(0)
  })
})

test.describe("claim due date: month arithmetic, not 30-day arithmetic", () => {
  test("the ordinary twelve months", () => {
    expect(claimDueDate("2025-06-30", 12)).toBe("2026-06-30")
    expect(claimDueDate("2026-01-15", 6)).toBe("2026-07-15")
  })

  test("crosses a year boundary", () => {
    expect(claimDueDate("2025-11-20", 6)).toBe("2026-05-20")
    expect(claimDueDate("2025-12-31", 24)).toBe("2027-12-31")
  })

  test("a day that does not exist in the target month clamps, never rolls over", () => {
    // The bug this exists to prevent: Date() would turn this into 3 March.
    expect(claimDueDate("2025-08-31", 6)).toBe("2026-02-28")
    expect(claimDueDate("2025-08-31", 18)).toBe("2027-02-28")
    expect(claimDueDate("2025-01-31", 1)).toBe("2025-02-28")
    expect(claimDueDate("2025-03-31", 1)).toBe("2025-04-30")
  })

  test("a leap year February is honoured", () => {
    expect(claimDueDate("2027-08-31", 6)).toBe("2028-02-29")
    expect(claimDueDate("2028-02-29", 12)).toBe("2029-02-28")
  })

  test("zero months is a real answer: released at practical completion", () => {
    expect(claimDueDate("2026-04-01", 0)).toBe("2026-04-01")
  })

  test("no date or no period means no claim date", () => {
    expect(claimDueDate(null, 12)).toBeNull()
    expect(claimDueDate("2026-04-01", null)).toBeNull()
    expect(claimDueDate("", 12)).toBeNull()
    expect(claimDueDate("not a date", 12)).toBeNull()
    expect(claimDueDate("2026-04-01", -1)).toBeNull()
  })

  test("a timestamp is accepted and truncated to its date", () => {
    expect(claimDueDate("2025-06-30T14:33:00.000Z", 12)).toBe("2026-06-30")
  })
})

test.describe("daysBetween", () => {
  test("counts whole days in both directions", () => {
    expect(daysBetween("2026-09-15", "2026-10-15")).toBe(30)
    expect(daysBetween("2026-10-15", "2026-09-15")).toBe(-30)
    expect(daysBetween("2026-09-15", "2026-09-15")).toBe(0)
  })

  test("is not thrown off by a BST-to-GMT crossing", () => {
    expect(daysBetween("2026-10-01", "2026-11-01")).toBe(31)
  })
})

test.describe("retentionFor: the state machine the UI branches on", () => {
  const base = {
    contractValue: 48000,
    retentionPercent: 5,
    practicalCompletionDate: "2025-10-15",
    defectsPeriodMonths: 12,
    retentionReleasedAt: null,
  }
  const TODAY = "2026-09-15"

  test("held, comfortably in the future", () => {
    const r = retentionFor({ ...base, practicalCompletionDate: "2026-06-01" }, TODAY)
    expect(r.state).toBe("held")
    expect(r.amountHeld).toBe(2400)
    expect(r.claimDueDate).toBe("2027-06-01")
  })

  test("due_soon starts exactly RETENTION_REMINDER_DAYS out, and not a day earlier", () => {
    const onBoard = retentionFor(base, "2026-09-15")
    expect(onBoard.claimDueDate).toBe("2026-10-15")
    expect(onBoard.daysUntilClaim).toBe(30)
    expect(onBoard.state).toBe("due_soon")

    const notYet = retentionFor(base, "2026-09-14")
    expect(notYet.daysUntilClaim).toBe(31)
    expect(notYet.state).toBe("held")
  })

  test("the day itself is claimable, not due_soon", () => {
    const r = retentionFor(base, "2026-10-15")
    expect(r.daysUntilClaim).toBe(0)
    expect(r.state).toBe("claimable")
  })

  test("a claim date long past stays claimable and never expires", () => {
    // The case the whole feature exists for: money owed since last year that
    // nobody chased.
    const r = retentionFor(base, "2028-01-01")
    expect(r.state).toBe("claimable")
    expect(r.daysUntilClaim).toBeLessThan(0)
    expect(r.amountHeld).toBe(2400)
  })

  test("released wins over everything, including an overdue date", () => {
    const r = retentionFor({ ...base, retentionReleasedAt: "2026-10-20T09:00:00Z" }, "2028-01-01")
    expect(r.state).toBe("released")
    expect(isOutstanding(r.state)).toBe(false)
    expect(needsAttention(r.state)).toBe(false)
  })

  test("retention with no practical completion date has not started", () => {
    const r = retentionFor({ ...base, practicalCompletionDate: null }, TODAY)
    expect(r.state).toBe("not_started")
    expect(r.claimDueDate).toBeNull()
    expect(r.amountHeld).toBe(2400)
    // Still owed to us, so it counts in the total.
    expect(isOutstanding(r.state)).toBe(true)
    // But there is nothing to chase yet, so it is not on TODAY.
    expect(needsAttention(r.state)).toBe(false)
  })

  test("no percentage means no retention at all", () => {
    const r = retentionFor({ ...base, retentionPercent: null }, TODAY)
    expect(r.state).toBe("none")
    expect(r.amountHeld).toBe(0)
    expect(isOutstanding(r.state)).toBe(false)
  })

  test("only due_soon and claimable reach the TODAY board", () => {
    expect(needsAttention("due_soon")).toBe(true)
    expect(needsAttention("claimable")).toBe(true)
    expect(needsAttention("held")).toBe(false)
    expect(needsAttention("not_started")).toBe(false)
    expect(needsAttention("none")).toBe(false)
    expect(needsAttention("released")).toBe(false)
  })

  test("the reminder window is the documented thirty days", () => {
    expect(RETENTION_REMINDER_DAYS).toBe(30)
  })
})

test.describe("formatMoney", () => {
  test("always two decimals, grouped", () => {
    expect(formatMoney(2400)).toBe("£2,400.00")
    expect(formatMoney(407.5)).toBe("£407.50")
    expect(formatMoney(0)).toBe("£0.00")
    expect(formatMoney(1234567.891)).toBe("£1,234,567.89")
  })

  test("a bad value prints zero rather than NaN", () => {
    expect(formatMoney(NaN)).toBe("£0.00")
    expect(formatMoney(undefined as any)).toBe("£0.00")
  })
})
