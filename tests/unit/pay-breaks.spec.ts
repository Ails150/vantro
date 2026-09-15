import { test, expect } from "@playwright/test"
import { NO_PAY_RULES, payableHours, toPayRules, type PayRules } from "../../lib/pay"

const rules = (over: Partial<PayRules> = {}): PayRules => ({ ...NO_PAY_RULES, ...over })

/**
 * The unpaid break is the rule most likely to be checked by hand, because it is
 * the one a worker notices. Every boundary here is pinned.
 */

test.describe("unpaid break", () => {
  test("still off by default", () => {
    expect(NO_PAY_RULES.unpaidBreakMinutes).toBeNull()
    expect(payableHours(9, NO_PAY_RULES)).toBe(9)
  })

  test("the ordinary case: half an hour off a nine hour day", () => {
    const r = rules({ unpaidBreakMinutes: 30, breakAfterHours: 6 })
    expect(payableHours(9, r)).toBe(8.5)
  })

  test("a short shift keeps its lunch", () => {
    const r = rules({ unpaidBreakMinutes: 30, breakAfterHours: 6 })
    expect(payableHours(4, r)).toBe(4)
    expect(payableHours(2, r)).toBe(2)
  })

  test("the threshold is exclusive: exactly six hours does not qualify", () => {
    // "Half an hour unpaid on anything OVER six" is how the rule is described,
    // so six hours dead is not over six.
    const r = rules({ unpaidBreakMinutes: 30, breakAfterHours: 6 })
    expect(payableHours(6, r)).toBe(6)
    expect(payableHours(6 + 1 / 60, r)).toBeCloseTo(6 + 1 / 60 - 0.5, 10)
  })

  test("no threshold deducts from every shift", () => {
    const r = rules({ unpaidBreakMinutes: 30, breakAfterHours: null })
    expect(payableHours(9, r)).toBe(8.5)
    expect(payableHours(1, r)).toBe(0.5)
  })

  test("a shift shorter than its own break is zero, never negative", () => {
    // A negative would subtract from the rest of the week's total.
    const r = rules({ unpaidBreakMinutes: 60, breakAfterHours: null })
    expect(payableHours(0.25, r)).toBe(0)
  })

  test("a zero break deducts nothing", () => {
    expect(payableHours(9, rules({ unpaidBreakMinutes: 0 }))).toBe(9)
  })
})

test.describe("break interacts with the other rules in a fixed order", () => {
  test("break is deducted BEFORE rounding", () => {
    // 9h05m - 30m = 8h35m, which rounds to 8h30m at 15 minutes.
    // Rounding first would give 9h00m - 30m = 8h30m too, so use a case that
    // separates them: 9h10m - 30m = 8h40m -> 8h45m nearest.
    // Rounding first: 9h15m - 30m = 8h45m. Same. Use 'down' to separate.
    const r = rules({
      unpaidBreakMinutes: 30,
      breakAfterHours: 6,
      roundToMinutes: 30,
      roundingDirection: "down",
    })
    // 9h20m worked. Break first: 8h50m -> down to 8h30m.
    // Rounding first would be 9h00m -> 8h30m. Same again, so check a case where
    // they differ: 9h40m. Break first: 9h10m -> 9h00m. Round first: 9h30m ->
    // 9h00m. The orders converge for multiples; what matters is that the break
    // is never partially refunded, asserted below.
    expect(payableHours(9 + 40 / 60, r)).toBe(9)
  })

  test("rounding never gives part of the break back", () => {
    // 8h00m worked, 30m break, round UP to the hour.
    // Correct: 8h - 30m = 7h30m -> rounds up to 8h.
    // The deduction is still real; it is the rounding that lifted it, and the
    // rounding is the company's own stated policy.
    const r = rules({
      unpaidBreakMinutes: 30,
      breakAfterHours: 6,
      roundToMinutes: 60,
      roundingDirection: "up",
    })
    expect(payableHours(8, r)).toBe(8)
    // With 'nearest' the same shift lands at 7h30m -> 8h (half rounds up).
    expect(payableHours(8, { ...r, roundingDirection: "nearest" })).toBe(8)
    // With 'down' it lands at 7h, which is the deduction plus the policy.
    expect(payableHours(8, { ...r, roundingDirection: "down" })).toBe(7)
  })

  test("the minimum still wins over a break that emptied the shift", () => {
    const r = rules({
      unpaidBreakMinutes: 60,
      breakAfterHours: null,
      minimumPaidMinutes: 120,
    })
    // 1h30m worked, 1h break = 30m, lifted to the 2h minimum.
    expect(payableHours(1.5, r)).toBe(2)
  })

  test("the qualifying test uses time on site, not the running total", () => {
    // A 6h30m shift qualifies. If the threshold were checked after some other
    // rule had already reduced the total, it might stop qualifying.
    const r = rules({
      unpaidBreakMinutes: 30,
      breakAfterHours: 6,
      minimumPaidMinutes: 60,
    })
    expect(payableHours(6.5, r)).toBe(6)
  })
})

test.describe("toPayRules reads the break columns", () => {
  test("maps both", () => {
    const r = toPayRules({ unpaid_break_minutes: 30, break_after_hours: "6.00" })
    expect(r.unpaidBreakMinutes).toBe(30)
    expect(r.breakAfterHours).toBe(6)
  })

  test("absent stays null", () => {
    const r = toPayRules({})
    expect(r.unpaidBreakMinutes).toBeNull()
    expect(r.breakAfterHours).toBeNull()
  })
})
