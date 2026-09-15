import { test, expect } from "@playwright/test"
import { NO_PAY_RULES, payForWeek, splitWeek, toPayRules, type PayRules } from "../../lib/pay"

const rules = (over: Partial<PayRules> = {}): PayRules => ({ ...NO_PAY_RULES, ...over })
const BOXING_DAY = new Set(["2026-12-28"])

const week = (...pairs: Array<[string, number]>) =>
  pairs.map(([date, hours]) => ({ date, hours }))

test.describe("no multiplier means a bank holiday is an ordinary day", () => {
  test("hours are NOT separated out", () => {
    // This is the important one. Separating them anyway would silently exclude
    // them from a weekly overtime threshold for a company that never asked for
    // bank holiday pay at all.
    const s = splitWeek(
      week(["2026-12-28", 8], ["2026-12-29", 8], ["2026-12-30", 8], ["2026-12-31", 8], ["2027-01-01", 10]),
      BOXING_DAY,
      rules({ overtimeWeeklyThresholdHours: 40 }),
    )
    expect(s.bankHolidayHours).toBe(0)
    expect(s.overtime.totalHours).toBe(42)
    expect(s.overtime.overtimeHours).toBe(2)
  })

  test("a multiplier below 1 is treated as no multiplier", () => {
    const s = splitWeek(week(["2026-12-28", 8]), BOXING_DAY, rules({ bankHolidayMultiplier: 0.5 }))
    expect(s.bankHolidayHours).toBe(0)
    expect(s.overtime.totalHours).toBe(8)
  })
})

test.describe("with a multiplier, holiday hours come out first", () => {
  test("they are separated from the week", () => {
    const s = splitWeek(
      week(["2026-12-28", 8], ["2026-12-29", 8]),
      BOXING_DAY,
      rules({ bankHolidayMultiplier: 2 }),
    )
    expect(s.bankHolidayHours).toBe(8)
    expect(s.overtime.totalHours).toBe(8)
  })

  test("they do NOT push the rest of the week into weekly overtime", () => {
    // 8 on the holiday plus 40 ordinary. The holiday hours are already
    // enhanced, so the ordinary 40 sit exactly on the threshold and nothing is
    // overtime.
    const s = splitWeek(
      week(
        ["2026-12-28", 8], ["2026-12-29", 10], ["2026-12-30", 10],
        ["2026-12-31", 10], ["2027-01-01", 10],
      ),
      BOXING_DAY,
      rules({ bankHolidayMultiplier: 2, overtimeWeeklyThresholdHours: 40 }),
    )
    expect(s.bankHolidayHours).toBe(8)
    expect(s.overtime.totalHours).toBe(40)
    expect(s.overtime.overtimeHours).toBe(0)
  })

  test("daily overtime still applies to the ordinary days", () => {
    const s = splitWeek(
      week(["2026-12-28", 8], ["2026-12-29", 10]),
      BOXING_DAY,
      rules({ bankHolidayMultiplier: 2, overtimeDailyThresholdHours: 8 }),
    )
    expect(s.bankHolidayHours).toBe(8)
    expect(s.overtime.overtimeHours).toBe(2)
    expect(s.overtime.basicHours).toBe(8)
  })

  test("a long bank holiday shift never earns daily overtime as well", () => {
    // Twelve hours on the holiday. Under (c) it is all at the holiday rate and
    // none of it is overtime -- it must never collect two multipliers.
    const s = splitWeek(
      week(["2026-12-28", 12]),
      BOXING_DAY,
      rules({ bankHolidayMultiplier: 2, overtimeDailyThresholdHours: 8 }),
    )
    expect(s.bankHolidayHours).toBe(12)
    expect(s.overtime.overtimeHours).toBe(0)
    expect(s.overtime.totalHours).toBe(0)
  })
})

test.describe("payForWeek", () => {
  test("double time on the holiday, basic on the rest", () => {
    const s = splitWeek(
      week(["2026-12-28", 8], ["2026-12-29", 8]),
      BOXING_DAY,
      rules({ bankHolidayMultiplier: 2 }),
    )
    const p = payForWeek(s, 20, rules({ bankHolidayMultiplier: 2 }))
    expect(p.bankHoliday).toBe(320) // 8 x 40
    expect(p.basic).toBe(160)       // 8 x 20
    expect(p.overtime).toBe(0)
    expect(p.total).toBe(480)
  })

  test("the parts always add up to the total", () => {
    const r = rules({
      bankHolidayMultiplier: 1.5,
      overtimeDailyThresholdHours: 8,
      overtimeMultiplier: 1.5,
    })
    const s = splitWeek(week(["2026-12-28", 9], ["2026-12-29", 10]), BOXING_DAY, r)
    const p = payForWeek(s, 18.33, r)
    const sum = Math.round((p.basic! + p.overtime! + p.bankHoliday!) * 100) / 100
    expect(sum).toBe(p.total)
  })

  test("the holiday rate is rounded in pence, like the overtime rate", () => {
    // 18.33 x 1.5 = 27.495 -> 27.50, not 27.49.
    const r = rules({ bankHolidayMultiplier: 1.5 })
    const s = splitWeek(week(["2026-12-28", 10]), BOXING_DAY, r)
    expect(payForWeek(s, 18.33, r).bankHoliday).toBe(275)
  })

  test("no rate is null throughout", () => {
    const s = splitWeek(week(["2026-12-28", 8]), BOXING_DAY, rules({ bankHolidayMultiplier: 2 }))
    expect(payForWeek(s, null, rules({ bankHolidayMultiplier: 2 }))).toEqual({
      basic: null, overtime: null, bankHoliday: null, total: null,
    })
  })
})

test.describe("toPayRules reads the bank holiday column", () => {
  test("maps it", () => {
    expect(toPayRules({ bank_holiday_multiplier: "2.00" }).bankHolidayMultiplier).toBe(2)
  })
  test("absent stays null", () => {
    expect(toPayRules({}).bankHolidayMultiplier).toBeNull()
  })
})
