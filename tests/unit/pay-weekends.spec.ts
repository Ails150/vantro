import { test, expect } from "@playwright/test"
import {
  NO_PAY_RULES, enhancementFor, payForWeek, splitWeek, toPayRules, type PayRules,
} from "../../lib/pay"

const rules = (over: Partial<PayRules> = {}): PayRules => ({ ...NO_PAY_RULES, ...over })
const NONE = new Set<string>()

// 2026-09-12 is a Saturday, 2026-09-13 a Sunday, 2026-09-14 a Monday.
const SAT = "2026-09-12"
const SUN = "2026-09-13"
const MON = "2026-09-14"

test.describe("enhancementFor", () => {
  test("nothing configured means no day is enhanced", () => {
    for (const d of [SAT, SUN, MON]) {
      expect(enhancementFor(d, NONE, NO_PAY_RULES)).toBeNull()
    }
  })

  test("Saturday and Sunday are recognised", () => {
    const r = rules({ saturdayMultiplier: 1.5, sundayMultiplier: 2 })
    expect(enhancementFor(SAT, NONE, r)).toEqual({ kind: "saturday", multiplier: 1.5 })
    expect(enhancementFor(SUN, NONE, r)).toEqual({ kind: "sunday", multiplier: 2 })
    expect(enhancementFor(MON, NONE, r)).toBeNull()
  })

  test("a multiplier of exactly 1 is not an enhancement", () => {
    // Otherwise those hours would silently leave the weekly overtime threshold
    // for a company that gets no benefit from it.
    const r = rules({ saturdayMultiplier: 1, sundayMultiplier: 1 })
    expect(enhancementFor(SAT, NONE, r)).toBeNull()
    expect(enhancementFor(SUN, NONE, r)).toBeNull()
  })

  test("a bank holiday on a weekday is recognised", () => {
    const r = rules({ bankHolidayMultiplier: 2 })
    expect(enhancementFor(MON, new Set([MON]), r)).toEqual({ kind: "bank_holiday", multiplier: 2 })
  })

  test("a day that is BOTH takes the highest single multiplier, never the product", () => {
    // Christmas Day on a Sunday. Nobody's contract says 4x.
    const r = rules({ sundayMultiplier: 2, bankHolidayMultiplier: 1.5 })
    const e = enhancementFor(SUN, new Set([SUN]), r)
    expect(e!.multiplier).toBe(2)
    expect(e!.kind).toBe("sunday")

    const r2 = rules({ sundayMultiplier: 1.5, bankHolidayMultiplier: 2 })
    const e2 = enhancementFor(SUN, new Set([SUN]), r2)
    expect(e2!.multiplier).toBe(2)
    expect(e2!.kind).toBe("bank_holiday")
  })

  test("a tie resolves to the bank holiday, the more specific reason", () => {
    const r = rules({ sundayMultiplier: 2, bankHolidayMultiplier: 2 })
    expect(enhancementFor(SUN, new Set([SUN]), r)!.kind).toBe("bank_holiday")
  })

  test("the day of week is read in UTC, so an offset cannot shift it", () => {
    // Parsed at noon: a naive local parse can roll midnight onto the previous
    // day and turn a Friday into a Saturday.
    const r = rules({ saturdayMultiplier: 1.5 })
    expect(enhancementFor("2026-09-11", NONE, r)).toBeNull() // Friday
    expect(enhancementFor("2026-09-12T23:30:00Z", NONE, r)!.kind).toBe("saturday")
  })

  test("garbage is not enhanced rather than throwing", () => {
    const r = rules({ saturdayMultiplier: 1.5, sundayMultiplier: 2 })
    for (const bad of ["", "not-a-date", null as any, undefined as any]) {
      expect(() => enhancementFor(bad, NONE, r)).not.toThrow()
      expect(enhancementFor(bad, NONE, r)).toBeNull()
    }
  })
})

test.describe("weekend hours leave the week before overtime", () => {
  const r = rules({
    saturdayMultiplier: 1.5,
    sundayMultiplier: 2,
    overtimeWeeklyThresholdHours: 40,
    overtimeMultiplier: 1.5,
  })

  test("they are separated out", () => {
    const s = splitWeek(
      [{ date: MON, hours: 8 }, { date: SAT, hours: 6 }, { date: SUN, hours: 4 }],
      NONE, r,
    )
    expect(s.enhancedHours).toBe(10)
    expect(s.overtime.totalHours).toBe(8)
    expect(s.enhanced.map(e => e.kind).sort()).toEqual(["saturday", "sunday"])
  })

  test("they do not push the weekdays into weekly overtime", () => {
    // 40 weekday hours plus a 8h Saturday. The Saturday is already enhanced, so
    // the weekdays sit exactly on the threshold and nothing is overtime.
    const days = [
      { date: "2026-09-07", hours: 8 }, { date: "2026-09-08", hours: 8 },
      { date: "2026-09-09", hours: 8 }, { date: "2026-09-10", hours: 8 },
      { date: "2026-09-11", hours: 8 }, { date: SAT, hours: 8 },
    ]
    const s = splitWeek(days, NONE, r)
    expect(s.overtime.totalHours).toBe(40)
    expect(s.overtime.overtimeHours).toBe(0)
    expect(s.enhancedHours).toBe(8)
  })

  test("a long Saturday never also earns daily overtime", () => {
    const withDaily = { ...r, overtimeDailyThresholdHours: 8 }
    const s = splitWeek([{ date: SAT, hours: 12 }], NONE, withDaily)
    expect(s.enhancedHours).toBe(12)
    expect(s.overtime.overtimeHours).toBe(0)
  })
})

test.describe("payForWeek with weekends", () => {
  test("Saturday at 1.5 and Sunday at 2.0 on top of basic weekdays", () => {
    const r = rules({ saturdayMultiplier: 1.5, sundayMultiplier: 2 })
    const s = splitWeek(
      [{ date: MON, hours: 8 }, { date: SAT, hours: 4 }, { date: SUN, hours: 2 }],
      NONE, r,
    )
    const p = payForWeek(s, 20, r)
    expect(p.basic).toBe(160)                    // 8 x 20
    expect(p.enhanced).toBe(4 * 30 + 2 * 40)     // 120 + 80
    expect(p.total).toBe(360)
  })

  test("the parts always add up to the total", () => {
    const r = rules({
      saturdayMultiplier: 1.5, sundayMultiplier: 2,
      overtimeDailyThresholdHours: 8, overtimeMultiplier: 1.5,
    })
    const s = splitWeek(
      [{ date: MON, hours: 10 }, { date: SAT, hours: 7.25 }, { date: SUN, hours: 3.5 }],
      NONE, r,
    )
    const p = payForWeek(s, 18.33, r)
    const sum = Math.round((p.basic! + p.overtime! + p.enhanced!) * 100) / 100
    expect(sum).toBe(p.total)
  })

  test("no weekend rules means weekend hours are ordinary", () => {
    const s = splitWeek([{ date: SAT, hours: 8 }], NONE, NO_PAY_RULES)
    expect(s.enhancedHours).toBe(0)
    expect(s.overtime.totalHours).toBe(8)
    expect(payForWeek(s, 20, NO_PAY_RULES).total).toBe(160)
  })
})

test.describe("toPayRules reads the weekend columns", () => {
  test("maps both", () => {
    const r = toPayRules({ saturday_multiplier: "1.50", sunday_multiplier: "2.00" })
    expect(r.saturdayMultiplier).toBe(1.5)
    expect(r.sundayMultiplier).toBe(2)
  })
  test("absent stays null", () => {
    expect(toPayRules({}).saturdayMultiplier).toBeNull()
    expect(toPayRules({}).sundayMultiplier).toBeNull()
  })
})
