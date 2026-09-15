import { test, expect } from "@playwright/test"
import { addBonuses, parseBonusAmount } from "../../lib/pay"

test.describe("parseBonusAmount", () => {
  test("accepts an ordinary bonus", () => {
    expect(parseBonusAmount("250")).toEqual({ ok: true, amount: 250 })
    expect(parseBonusAmount(199.99)).toEqual({ ok: true, amount: 199.99 })
  })

  test("negative is allowed, because a deduction is a bonus with a minus sign", () => {
    // Refusing these pushes corrections into a spreadsheet.
    expect(parseBonusAmount(-75)).toEqual({ ok: true, amount: -75 })
  })

  test("zero is refused", () => {
    const r = parseBonusAmount(0)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.why).toContain("not a bonus")
  })

  test("blank is refused", () => {
    expect(parseBonusAmount("").ok).toBe(false)
    expect(parseBonusAmount(null).ok).toBe(false)
  })

  test("a misplaced decimal point is refused", () => {
    expect(parseBonusAmount(250000).ok).toBe(false)
    expect(parseBonusAmount(-250000).ok).toBe(false)
  })

  test("more than two decimals is refused", () => {
    expect(parseBonusAmount(100.555).ok).toBe(false)
    expect(parseBonusAmount(100.55).ok).toBe(true)
  })

  test("not a number is refused", () => {
    expect(parseBonusAmount("two hundred").ok).toBe(false)
  })
})

test.describe("addBonuses", () => {
  test("adds to a week's pay", () => {
    expect(addBonuses({ total: 800 }, [250, 50])).toEqual({ bonuses: 300, total: 1100 })
  })

  test("a deduction subtracts", () => {
    expect(addBonuses({ total: 800 }, [-75])).toEqual({ bonuses: -75, total: 725 })
  })

  test("no bonuses leaves the total alone", () => {
    expect(addBonuses({ total: 800 }, [])).toEqual({ bonuses: 0, total: 800 })
  })

  test("summing in pence does not drift", () => {
    const many = new Array(100).fill(0.07)
    expect(addBonuses({ total: 0 }, many).bonuses).toBe(7)
  })

  test("a bonus with no rate still pays the bonus", () => {
    // Somebody can legitimately be paid a bonus and nothing else.
    expect(addBonuses({ total: null }, [250])).toEqual({ bonuses: 250, total: 250 })
  })

  test("no rate and no bonuses stays unknown, not zero", () => {
    expect(addBonuses({ total: null }, [])).toEqual({ bonuses: 0, total: null })
  })

  test("nonsense entries are skipped rather than poisoning the total", () => {
    expect(addBonuses({ total: 100 }, [50, NaN as any, Infinity as any])).toEqual({
      bonuses: 50, total: 150,
    })
  })
})
