import { test, expect } from "@playwright/test"
import { NO_PAY_RULES, type PayRules } from "../../lib/pay"
import { buildPayrollLines, toPayrollCsv, totalPay, PAY_TYPES } from "../../lib/payroll-export"

const rules = (over: Partial<PayRules> = {}): PayRules => ({ ...NO_PAY_RULES, ...over })

// Week of Mon 7 Sept 2026. Day index 0 = Monday.
const dayIndexOf = (iso: string) => (new Date(iso).getUTCDay() + 6) % 7
const dateKeyOf = (iso: string) => iso.slice(0, 10)
const NONE = new Set<string>()

const shift = (id: string, date: string, from: string, to: string) => ({
  id, signedInAt: `${date}T${from}:00.000Z`, signedOutAt: `${date}T${to}:00.000Z`,
})

const STANDARD = rules({
  overtimeDailyThresholdHours: 8,
  overtimeWeeklyThresholdHours: 40,
  overtimeMultiplier: 1.5,
  saturdayMultiplier: 1.5,
  sundayMultiplier: 2,
  bankHolidayMultiplier: 2,
})

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

test.describe("one line per worker per pay type", () => {
  test("a plain week is a single Ordinary Hours line", () => {
    const lines = buildPayrollLines(
      [{
        userId: "u1", name: "Ann", email: "a@b.com", rate: 20,
        shifts: [shift("s1", "2026-09-07", "09:00", "17:00")],
        bonuses: [],
      }],
      STANDARD, NONE, dayIndexOf, dateKeyOf,
    )
    expect(lines).toHaveLength(1)
    expect(lines[0].payType).toBe("Ordinary Hours")
    expect(lines[0].hours).toBe(8)
    expect(lines[0].rate).toBe(20)
    expect(lines[0].amount).toBe(160)
  })

  test("a long day splits into Ordinary and Overtime 1.5, each with its own rate", () => {
    const lines = buildPayrollLines(
      [{
        userId: "u1", name: "Ann", email: "a@b.com", rate: 20,
        shifts: [shift("s1", "2026-09-07", "09:00", "19:00")],
        bonuses: [],
      }],
      STANDARD, NONE, dayIndexOf, dateKeyOf,
    )
    const ord = lines.find(l => l.payType === "Ordinary Hours")!
    const ot = lines.find(l => l.payType === "Overtime 1.5")!
    expect(ord.hours).toBe(8)
    expect(ord.rate).toBe(20)
    expect(ord.amount).toBe(160)
    expect(ot.hours).toBe(2)
    // 20 x 1.5. The rate the old hours-only CSV had no way of saying.
    expect(ot.rate).toBe(30)
    expect(ot.amount).toBe(60)
    expect(totalPay(lines)).toBe(220)
  })

  test("a 2.0 multiplier lands on the Overtime 2.0 line", () => {
    const lines = buildPayrollLines(
      [{
        userId: "u1", name: "Ann", email: "a@b.com", rate: 20,
        shifts: [shift("s1", "2026-09-07", "09:00", "19:00")],
        bonuses: [],
      }],
      rules({ overtimeDailyThresholdHours: 8, overtimeMultiplier: 2 }),
      NONE, dayIndexOf, dateKeyOf,
    )
    expect(lines.find(l => l.payType === "Overtime 2.0")!.rate).toBe(40)
    expect(lines.find(l => l.payType === "Overtime 1.5")).toBeUndefined()
  })

  test("Saturday, Sunday and Bank Holiday each get their own line and rate", () => {
    const lines = buildPayrollLines(
      [{
        userId: "u1", name: "Ann", email: "a@b.com", rate: 20,
        shifts: [
          shift("s1", "2026-09-07", "09:00", "17:00"), // Mon, a bank holiday below
          shift("s2", "2026-09-12", "09:00", "13:00"), // Sat
          shift("s3", "2026-09-13", "09:00", "12:00"), // Sun
        ],
        bonuses: [],
      }],
      STANDARD, new Set(["2026-09-07"]), dayIndexOf, dateKeyOf,
    )
    const sat = lines.find(l => l.payType === "Saturday")!
    const sun = lines.find(l => l.payType === "Sunday")!
    const bh = lines.find(l => l.payType === "Bank Holiday")!
    expect([sat.hours, sat.rate, sat.amount]).toEqual([4, 30, 120])
    expect([sun.hours, sun.rate, sun.amount]).toEqual([3, 40, 120])
    expect([bh.hours, bh.rate, bh.amount]).toEqual([8, 40, 320])
    // Enhanced days never reach the ordinary line.
    expect(lines.find(l => l.payType === "Ordinary Hours")).toBeUndefined()
  })

  test("a bonus is an amount with no hours and no rate", () => {
    const lines = buildPayrollLines(
      [{
        userId: "u1", name: "Ann", email: "a@b.com", rate: 20,
        shifts: [shift("s1", "2026-09-07", "09:00", "17:00")],
        bonuses: [{ amount: 50, reason: "covered Saturday" }],
      }],
      STANDARD, NONE, dayIndexOf, dateKeyOf,
    )
    const bonus = lines.find(l => l.payType === "Bonus")!
    expect(bonus.hours).toBeNull()
    expect(bonus.rate).toBeNull()
    expect(bonus.amount).toBe(50)
    expect(totalPay(lines)).toBe(210)
  })

  test("a negative bonus is a deduction and reduces the total", () => {
    const lines = buildPayrollLines(
      [{
        userId: "u1", name: "Ann", email: "a@b.com", rate: 20,
        shifts: [shift("s1", "2026-09-07", "09:00", "17:00")],
        bonuses: [{ amount: -30, reason: "damaged tool" }],
      }],
      STANDARD, NONE, dayIndexOf, dateKeyOf,
    )
    expect(totalPay(lines)).toBe(130)
  })
})

test.describe("overlap is removed before anything is priced", () => {
  test("two concurrent shifts are paid once and flagged", () => {
    const lines = buildPayrollLines(
      [{
        userId: "u1", name: "Ann", email: "a@b.com", rate: 20,
        shifts: [
          shift("s1", "2026-09-07", "09:00", "17:00"),
          shift("s2", "2026-09-07", "09:00", "17:00"),
        ],
        bonuses: [],
      }],
      STANDARD, NONE, dayIndexOf, dateKeyOf,
    )
    expect(lines.find(l => l.payType === "Ordinary Hours")!.hours).toBe(8)
    expect(totalPay(lines)).toBe(160) // not 320
    expect(lines.every(l => l.overlapTrimmed)).toBe(true)
  })

  test("a clean week is not flagged", () => {
    const lines = buildPayrollLines(
      [{
        userId: "u1", name: "Ann", email: "a@b.com", rate: 20,
        shifts: [shift("s1", "2026-09-07", "09:00", "17:00")],
        bonuses: [],
      }],
      STANDARD, NONE, dayIndexOf, dateKeyOf,
    )
    expect(lines.every(l => l.overlapTrimmed)).toBe(false)
  })
})

test.describe("the CSV", () => {
  const lines = buildPayrollLines(
    [{
      userId: "u1", name: "Ann", email: "a@b.com", rate: 20,
      shifts: [shift("s1", "2026-09-07", "09:00", "19:00")],
      bonuses: [{ amount: 25, reason: "x" }],
    }],
    STANDARD, NONE, dayIndexOf, dateKeyOf,
  )
  const csv = toPayrollCsv(lines, DAY_LABELS)

  test("carries hours, rate and amount", () => {
    expect(csv.split("\n")[0]).toContain("Hours,Rate,Amount")
  })

  test("has a total row that equals the sum", () => {
    const totalLine = csv.split("\n").find(l => l.startsWith("TOTAL"))!
    expect(totalLine).toContain(totalPay(lines).toFixed(2))
    expect(totalPay(lines)).toBe(245) // 160 + 60 + 25
  })

  test("lines are grouped by employee and ordered by pay type", () => {
    const types = csv.split("\n").slice(1, -1).map(l => l.split(",")[2])
    const expected = types
      .slice()
      .sort((a, b) => PAY_TYPES.indexOf(a as any) - PAY_TYPES.indexOf(b as any))
    expect(types).toEqual(expected)
  })

  test("a name with a comma does not break the file", () => {
    const tricky = buildPayrollLines(
      [{
        userId: "u1", name: "Smith, Ann", email: "a@b.com", rate: 20,
        shifts: [shift("s1", "2026-09-07", "09:00", "17:00")],
        bonuses: [],
      }],
      STANDARD, NONE, dayIndexOf, dateKeyOf,
    )
    const out = toPayrollCsv(tricky, DAY_LABELS)
    expect(out).toContain('"Smith, Ann"')
    expect(out.split("\n")[1].split(",").length).toBeGreaterThan(13)
  })
})

test.describe("no rate set", () => {
  test("hours are still reported, priced at nothing, rather than omitted", () => {
    const lines = buildPayrollLines(
      [{
        userId: "u1", name: "Ann", email: "a@b.com", rate: null,
        shifts: [shift("s1", "2026-09-07", "09:00", "17:00")],
        bonuses: [],
      }],
      STANDARD, NONE, dayIndexOf, dateKeyOf,
    )
    const ord = lines.find(l => l.payType === "Ordinary Hours")!
    expect(ord.hours).toBe(8)
    expect(ord.rate).toBeNull()
    expect(ord.amount).toBe(0)
  })
})
