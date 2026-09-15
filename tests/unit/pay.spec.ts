import { test, expect } from "@playwright/test"
import {
  formatPay,
  formatRate,
  parseRate,
  payFor,
  resolveRate,
  sumPay,
} from "../../lib/pay"

/**
 * Pay figures get handed to a bookkeeper and, downstream, to a worker. Every
 * number here is either right or it is somebody underpaid, so the arithmetic is
 * pinned rather than eyeballed on a screen.
 */

test.describe("resolveRate: null and zero are not the same thing", () => {
  test("a worker's own rate wins", () => {
    expect(resolveRate(18.5, 15)).toEqual({ rate: 18.5, source: "worker" })
  })

  test("no worker rate falls back to the company default", () => {
    expect(resolveRate(null, 15)).toEqual({ rate: 15, source: "company_default" })
    expect(resolveRate(undefined, 15)).toEqual({ rate: 15, source: "company_default" })
  })

  test("a deliberate zero does NOT fall back", () => {
    // An unpaid director set to 0 must not silently start being paid the
    // company default.
    expect(resolveRate(0, 15)).toEqual({ rate: 0, source: "worker" })
  })

  test("neither set is unset, not zero", () => {
    expect(resolveRate(null, null)).toEqual({ rate: null, source: "unset" })
    expect(resolveRate(undefined, undefined)).toEqual({ rate: null, source: "unset" })
  })
})

test.describe("payFor: pence, not floats", () => {
  test("the float that would otherwise reach a payslip", () => {
    // 7.5 * 18.6 is 139.50000000000003 in binary floating point.
    expect(payFor(7.5, 18.6)).toBe(139.5)
    expect(String(payFor(7.5, 18.6))).toBe("139.5")
  })

  test("ordinary shifts", () => {
    expect(payFor(8, 15)).toBe(120)
    expect(payFor(7.5, 22.4)).toBe(168)
  })

  test("awkward hours round to the penny", () => {
    // 7h31m = 7.516666... hours at 18.00
    expect(payFor(7.516666666666667, 18)).toBe(135.3)
  })

  test("no rate is null, never zero", () => {
    // Zero would mean "worked, earned nothing", which is a different claim.
    expect(payFor(8, null)).toBeNull()
  })

  test("a zero rate pays zero", () => {
    expect(payFor(8, 0)).toBe(0)
  })

  test("zero or nonsense hours are zero, not a crash", () => {
    expect(payFor(0, 18)).toBe(0)
    expect(payFor(-4, 18)).toBe(0)
    expect(payFor(NaN, 18)).toBe(0)
  })
})

test.describe("sumPay: the total must equal the visible rows", () => {
  test("adds already-rounded shift figures", () => {
    const shifts = [payFor(7.5, 18.6), payFor(8, 18.6), payFor(6.25, 18.6)]
    expect(shifts).toEqual([139.5, 148.8, 116.25])
    expect(sumPay(shifts)).toEqual({ total: 404.55, unpriced: 0 })
  })

  test("nulls are counted, not silently treated as zero", () => {
    expect(sumPay([120, null, 80, null])).toEqual({ total: 200, unpriced: 2 })
  })

  test("an empty week is zero and nothing unpriced", () => {
    expect(sumPay([])).toEqual({ total: 0, unpriced: 0 })
  })

  test("summing many rows does not drift", () => {
    // Fifty identical awkward shifts. Summing floats would drift here.
    const one = payFor(7.516666666666667, 18.33)!
    const total = sumPay(new Array(50).fill(one)).total
    expect(total).toBe(Math.round(one * 50 * 100) / 100)
  })
})

test.describe("parseRate: refuse the typo that multiplies a week by a hundred", () => {
  test("accepts a normal rate", () => {
    expect(parseRate("18.50")).toEqual({ ok: true, rate: 18.5 })
    expect(parseRate(22)).toEqual({ ok: true, rate: 22 })
    expect(parseRate("0")).toEqual({ ok: true, rate: 0 })
  })

  test("blank clears the rate", () => {
    expect(parseRate("")).toEqual({ ok: true, rate: null })
    expect(parseRate(null)).toEqual({ ok: true, rate: null })
    expect(parseRate(undefined)).toEqual({ ok: true, rate: null })
  })

  test("a rate typed in pence is refused", () => {
    const r = parseRate(1850)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.why).toContain("pence")
  })

  test("negative is refused", () => {
    expect(parseRate(-5).ok).toBe(false)
  })

  test("not a number is refused", () => {
    expect(parseRate("eighteen").ok).toBe(false)
  })

  test("more than two decimals is refused rather than silently rounded", () => {
    expect(parseRate(18.555).ok).toBe(false)
    expect(parseRate(18.55).ok).toBe(true)
  })
})

test.describe("formatting", () => {
  test("pay always shows two decimals", () => {
    expect(formatPay(139.5)).toBe("£139.50")
    expect(formatPay(0)).toBe("£0.00")
    expect(formatPay(1234.5)).toBe("£1,234.50")
  })

  test("unknown pay is a dash, not zero", () => {
    expect(formatPay(null)).toBe("—")
  })

  test("an unset rate says so", () => {
    expect(formatRate(null)).toBe("Not set")
    expect(formatRate(18.5)).toBe("£18.50/hr")
    expect(formatRate(0)).toBe("£0.00/hr")
  })
})
