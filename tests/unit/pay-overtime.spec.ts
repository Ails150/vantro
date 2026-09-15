import { test, expect } from "@playwright/test"
import { NO_PAY_RULES, payForSplit, splitOvertime, toPayRules, type PayRules } from "../../lib/pay"

const rules = (over: Partial<PayRules> = {}): PayRules => ({ ...NO_PAY_RULES, ...over })

const week = (...hours: number[]) =>
  hours.map((h, i) => ({ date: `2026-09-${String(14 + i).padStart(2, "0")}`, hours: h }))

test.describe("no overtime rules means everything is basic", () => {
  test("a fifty hour week is fifty basic hours", () => {
    const s = splitOvertime(week(10, 10, 10, 10, 10), NO_PAY_RULES)
    expect(s).toEqual({
      basicHours: 50, overtimeHours: 0, totalHours: 50, fromDaily: 0, fromWeekly: 0,
    })
  })
})

test.describe("daily threshold", () => {
  test("hours above the daily threshold are overtime", () => {
    const s = splitOvertime(week(10, 8, 9, 8, 8), rules({ overtimeDailyThresholdHours: 8 }))
    expect(s.fromDaily).toBe(3) // 2 on Monday, 1 on Wednesday
    expect(s.overtimeHours).toBe(3)
    expect(s.basicHours).toBe(40)
    expect(s.totalHours).toBe(43)
  })

  test("exactly on the threshold is not overtime", () => {
    const s = splitOvertime(week(8, 8, 8), rules({ overtimeDailyThresholdHours: 8 }))
    expect(s.overtimeHours).toBe(0)
  })

  test("two shifts on one day are ONE day", () => {
    // 5 hours on one site and 5 on another is a ten hour day. Paying each shift
    // as if it stood alone would hide every bit of daily overtime a multi-site
    // company ever works.
    const s = splitOvertime(
      [
        { date: "2026-09-14", hours: 5 },
        { date: "2026-09-14", hours: 5 },
      ],
      rules({ overtimeDailyThresholdHours: 8 }),
    )
    expect(s.fromDaily).toBe(2)
    expect(s.basicHours).toBe(8)
  })
})

test.describe("weekly threshold", () => {
  test("hours above the weekly threshold are overtime", () => {
    const s = splitOvertime(week(9, 9, 9, 9, 9), rules({ overtimeWeeklyThresholdHours: 40 }))
    expect(s.fromWeekly).toBe(5)
    expect(s.basicHours).toBe(40)
  })

  test("under the threshold is all basic", () => {
    const s = splitOvertime(week(7, 7, 7), rules({ overtimeWeeklyThresholdHours: 40 }))
    expect(s.overtimeHours).toBe(0)
  })
})

test.describe("the double-counting trap", () => {
  test("an hour already paid as daily overtime is not paid again weekly", () => {
    // Five ten-hour days. Daily rule at 8 yields 10 overtime hours, leaving 40
    // basic. A weekly rule at 40 must then find NOTHING left to pay, because
    // the 40 remaining hours are exactly at the threshold.
    const s = splitOvertime(
      week(10, 10, 10, 10, 10),
      rules({ overtimeDailyThresholdHours: 8, overtimeWeeklyThresholdHours: 40 }),
    )
    expect(s.fromDaily).toBe(10)
    expect(s.fromWeekly).toBe(0)
    expect(s.overtimeHours).toBe(10)
    expect(s.basicHours).toBe(40)
    // The naive version would report 10 (raw total 50 - 40) on top of the 10
    // daily, paying 20 overtime hours for a 50 hour week.
    expect(s.overtimeHours).not.toBe(20)
  })

  test("weekly still bites on what daily left behind", () => {
    // Six nine-hour days = 54 hours. Daily at 8 takes 6. That leaves 48, and a
    // weekly threshold of 40 takes a further 8.
    const s = splitOvertime(
      week(9, 9, 9, 9, 9, 9),
      rules({ overtimeDailyThresholdHours: 8, overtimeWeeklyThresholdHours: 40 }),
    )
    expect(s.fromDaily).toBe(6)
    expect(s.fromWeekly).toBe(8)
    expect(s.overtimeHours).toBe(14)
    expect(s.basicHours).toBe(40)
    expect(s.basicHours + s.overtimeHours).toBe(s.totalHours)
  })

  test("basic and overtime always add up to the total", () => {
    const cases: Array<[number[], Partial<PayRules>]> = [
      [[10, 10, 10, 10, 10], { overtimeDailyThresholdHours: 8, overtimeWeeklyThresholdHours: 40 }],
      [[7.5, 7.5, 7.5, 7.5, 7.5], { overtimeWeeklyThresholdHours: 37.5 }],
      [[12, 4, 9.25], { overtimeDailyThresholdHours: 8 }],
      [[6, 6, 6], { overtimeDailyThresholdHours: 8, overtimeWeeklyThresholdHours: 40 }],
    ]
    for (const [hours, over] of cases) {
      const s = splitOvertime(week(...hours), rules(over))
      expect(s.basicHours + s.overtimeHours).toBeCloseTo(s.totalHours, 10)
    }
  })
})

test.describe("bad input", () => {
  test("zero and negative days are ignored", () => {
    const s = splitOvertime(
      [
        { date: "2026-09-14", hours: 8 },
        { date: "2026-09-15", hours: 0 },
        { date: "2026-09-16", hours: -4 },
        { date: "2026-09-17", hours: NaN },
      ],
      rules({ overtimeDailyThresholdHours: 8 }),
    )
    expect(s.totalHours).toBe(8)
    expect(s.overtimeHours).toBe(0)
  })

  test("an empty week is all zeroes", () => {
    expect(splitOvertime([], rules({ overtimeDailyThresholdHours: 8 }))).toEqual({
      basicHours: 0, overtimeHours: 0, totalHours: 0, fromDaily: 0, fromWeekly: 0,
    })
  })
})

test.describe("payForSplit", () => {
  const split = splitOvertime(
    week(10, 10, 10, 10, 10),
    rules({ overtimeDailyThresholdHours: 8 }),
  )

  test("time and a half on the worker's own rate", () => {
    const p = payForSplit(split, 20, rules({ overtimeMultiplier: 1.5 }))
    expect(p.basic).toBe(800)     // 40 x 20
    expect(p.overtime).toBe(300)  // 10 x 30
    expect(p.total).toBe(1100)
  })

  test("the components always add up to the total", () => {
    const p = payForSplit(split, 18.33, rules({ overtimeMultiplier: 1.5 }))
    expect(Math.round((p.basic! + p.overtime!) * 100) / 100).toBe(p.total)
  })

  test("the overtime rate is rounded to the penny, as a payslip would print it", () => {
    // 18.33 x 1.5 = 27.495, which is 27.50 on any document a worker reads.
    const p = payForSplit(split, 18.33, rules({ overtimeMultiplier: 1.5 }))
    expect(p.overtime).toBe(275) // 10 hours x 27.50
  })

  test("no multiplier pays overtime at basic rather than guessing 1.5", () => {
    const p = payForSplit(split, 20, rules())
    expect(p.overtime).toBe(200)
    expect(p.total).toBe(1000)
  })

  test("a multiplier below 1 is ignored rather than paying overtime worse", () => {
    const p = payForSplit(split, 20, rules({ overtimeMultiplier: 0.5 }))
    expect(p.overtime).toBe(200)
  })

  test("no rate is null throughout, never zero", () => {
    expect(payForSplit(split, null, rules({ overtimeMultiplier: 1.5 }))).toEqual({
      basic: null, overtime: null, total: null,
    })
  })
})

test.describe("toPayRules reads the overtime columns", () => {
  test("maps all three", () => {
    const r = toPayRules({
      overtime_daily_threshold_hours: "8.00",
      overtime_weekly_threshold_hours: "40.00",
      overtime_multiplier: "1.50",
    })
    expect(r.overtimeDailyThresholdHours).toBe(8)
    expect(r.overtimeWeeklyThresholdHours).toBe(40)
    expect(r.overtimeMultiplier).toBe(1.5)
  })
})
