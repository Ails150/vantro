import { test, expect } from "@playwright/test"
import { NO_PAY_RULES, payableHours, toPayRules, type PayRules } from "../../lib/pay"

/**
 * Pay rules change what a worker is owed. The property that matters most is the
 * one tested first: a company that has set no rules must be paid exactly as it
 * was before this table existed.
 */

const rules = (over: Partial<PayRules> = {}): PayRules => ({ ...NO_PAY_RULES, ...over })

test.describe("no rules means no change, ever", () => {
  test("an absent row is the no-op ruleset", () => {
    expect(toPayRules(null)).toEqual(NO_PAY_RULES)
    expect(toPayRules(undefined)).toEqual(NO_PAY_RULES)
  })

  test("worked hours pass through untouched", () => {
    for (const h of [7.5, 8, 0.25, 7.516666666666667, 12.75]) {
      expect(payableHours(h, NO_PAY_RULES)).toBe(h === 7.516666666666667 ? 451 / 60 : h)
    }
  })

  test("a shift of nothing is zero, not a crash", () => {
    expect(payableHours(0, NO_PAY_RULES)).toBe(0)
    expect(payableHours(-3, NO_PAY_RULES)).toBe(0)
    expect(payableHours(NaN, NO_PAY_RULES)).toBe(0)
  })
})

test.describe("rounding", () => {
  test("nearest quarter hour", () => {
    const r = rules({ roundToMinutes: 15 })
    expect(payableHours(7 + 37 / 60, r)).toBe(7.5)   // 7h37m -> 7h30m
    expect(payableHours(7 + 38 / 60, r)).toBe(7.75)  // 7h38m -> 7h45m
    expect(payableHours(8, r)).toBe(8)
  })

  test("a half lands UP, never to even", () => {
    // 7h37m30s would be the exact half; at minute resolution the boundary case
    // is 7h38m above. This pins the direction explicitly on a clean half.
    const r = rules({ roundToMinutes: 10 })
    expect(payableHours(7 + 5 / 60, r)).toBe(7 + 10 / 60) // 7h05m -> 7h10m
  })

  test("up always favours the worker", () => {
    const r = rules({ roundToMinutes: 15, roundingDirection: "up" })
    expect(payableHours(7 + 31 / 60, r)).toBe(7.75)
    expect(payableHours(7.5, r)).toBe(7.5) // already exact, not bumped
  })

  test("down always favours the company", () => {
    const r = rules({ roundToMinutes: 15, roundingDirection: "down" })
    expect(payableHours(7 + 44 / 60, r)).toBe(7.5)
    expect(payableHours(7.5, r)).toBe(7.5)
  })

  test("rounding to 1 minute is a no-op on whole minutes", () => {
    expect(payableHours(7.5, rules({ roundToMinutes: 1 }))).toBe(7.5)
  })
})

test.describe("minimum paid shift", () => {
  test("a short shift is lifted to the minimum", () => {
    const r = rules({ minimumPaidMinutes: 240 }) // 4 hours
    expect(payableHours(0.5, r)).toBe(4)
    expect(payableHours(1.75, r)).toBe(4)
  })

  test("a long shift is untouched", () => {
    expect(payableHours(7.5, rules({ minimumPaidMinutes: 240 }))).toBe(7.5)
  })

  test("a shift of literally nothing stays nothing", () => {
    // Somebody who never turned up is not owed the minimum.
    expect(payableHours(0, rules({ minimumPaidMinutes: 240 }))).toBe(0)
  })
})

test.describe("order of operations: the minimum is a floor, not a suggestion", () => {
  test("rounding DOWN cannot drop a shift back under the minimum", () => {
    // This is the bug the fixed order exists to prevent. Apply the minimum
    // first and then round down, and a 4h minimum with 60-minute down-rounding
    // on a 10 minute shift gives 4h -> 4h; but a 3h50m shift would give
    // 3h50 -> 4h(min) -> 3h(down) = under the floor.
    const r = rules({ roundToMinutes: 60, roundingDirection: "down", minimumPaidMinutes: 240 })
    expect(payableHours(3 + 50 / 60, r)).toBe(4)
  })

  test("rounding up then the minimum still respects both", () => {
    const r = rules({ roundToMinutes: 15, roundingDirection: "up", minimumPaidMinutes: 120 })
    expect(payableHours(0.1, r)).toBe(2)      // rounds to 15m, lifted to 2h
    expect(payableHours(2 + 1 / 60, r)).toBe(2.25) // rounds up past the minimum
  })
})

test.describe("toPayRules coercion", () => {
  test("reads a row", () => {
    // Exact equality on purpose: it catches a field being silently dropped from
    // the mapping. Spread over NO_PAY_RULES so that adding a rule to the type
    // makes this fail loudly once, here, rather than everywhere at random.
    expect(
      toPayRules({ round_to_minutes: 15, rounding_direction: "up", minimum_paid_minutes: 240 }),
    ).toEqual({
      ...NO_PAY_RULES,
      roundToMinutes: 15,
      roundingDirection: "up",
      minimumPaidMinutes: 240,
    })
  })

  test("an unknown direction falls back to nearest rather than throwing", () => {
    expect(toPayRules({ rounding_direction: "sideways" }).roundingDirection).toBe("nearest")
  })

  test("nulls stay null", () => {
    const r = toPayRules({ round_to_minutes: null, minimum_paid_minutes: null })
    expect(r.roundToMinutes).toBeNull()
    expect(r.minimumPaidMinutes).toBeNull()
  })
})
