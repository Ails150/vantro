import { test, expect } from "@playwright/test"
import { capturedSentence, londonMonthStart, summariseCaptured, type CapturedExpense, type CapturedVariation } from "../../lib/captured"

/**
 * The TODAY line and the Friday email both print this number, and it is the
 * one that tells a commercial manager what to put on the application. Pinned
 * with a worked example.
 */

const MONTH = "2026-09-01"

const v = (id: string, kind: string, status: string, pricePence: number | null, capturedAt: string): CapturedVariation =>
  ({ id, kind, status, pricePence, capturedAt })
const e = (id: string, status: string, jobId: string | null, amountPence: number, capturedAt: string): CapturedExpense =>
  ({ id, status, jobId, amountPence, capturedAt })

test("the worked example", () => {
  const variations = [
    v("vo1", "variation", "approved", 115010, "2026-09-03T10:00:00Z"), // counts
    v("dw1", "daywork", "sent", 38000, "2026-09-10T08:00:00Z"),       // counts
    v("vo2", "variation", "signed", 240000, "2026-08-28T12:00:00Z"),  // August: not this month
    v("vo3", "variation", "pending", null, "2026-09-11T12:00:00Z"),   // not priced
    v("vo4", "variation", "invoiced", 50000, "2026-09-05T12:00:00Z"), // already applied
    v("vo5", "variation", "signed", 70000, "2026-09-06T12:00:00Z"),   // on an application
    v("vo6", "variation", "declined", 90000, "2026-09-07T12:00:00Z"), // refused
  ]
  const expenses = [
    e("ex1", "approved", "job1", 6480, "2026-09-12T12:00:00Z"),  // counts
    e("ex2", "paid", "job1", 1250, "2026-09-13T12:00:00Z"),      // counts
    e("ex3", "approved", null, 9999, "2026-09-13T12:00:00Z"),    // no job, cannot be applied for
    e("ex4", "submitted", "job1", 5000, "2026-09-13T12:00:00Z"), // not approved
    e("ex5", "rejected", "job1", 5000, "2026-09-13T12:00:00Z"),
  ]
  const c = summariseCaptured(MONTH, variations, expenses, new Set(["vo5"]))

  expect(c.variations).toEqual({ count: 1, pence: 115010 })
  expect(c.dayworks).toEqual({ count: 1, pence: 38000 })
  expect(c.expenses).toEqual({ count: 2, pence: 7730 })
  // 115010 + 38000 + 6480 + 1250
  expect(c.pence).toBe(160740)
  expect(capturedSentence(c)).toBe("£1,607.40 captured this month is not on a payment application yet.")
})

test("nothing outstanding says so, rather than printing £0.00", () => {
  const c = summariseCaptured(MONTH, [], [], new Set())
  expect(capturedSentence(c)).toBe("Everything captured this month is on a payment application.")
})

test("the month starts at London midnight, not UTC midnight", () => {
  // 23:30 UTC on 31 August is 00:30 on 1 September in London (BST).
  const c = summariseCaptured(MONTH, [v("late", "variation", "approved", 100, "2026-08-31T23:30:00Z")], [], new Set())
  expect(c.pence).toBe(100)
  const d = summariseCaptured(MONTH, [v("early", "variation", "approved", 100, "2026-08-31T22:30:00Z")], [], new Set())
  expect(d.pence).toBe(0)
})

test("londonMonthStart follows the London calendar", () => {
  expect(londonMonthStart(new Date("2026-09-19T10:00:00Z"))).toBe("2026-09-01")
  expect(londonMonthStart(new Date("2026-08-31T23:30:00Z"))).toBe("2026-09-01")
  expect(londonMonthStart(new Date("2026-12-31T23:30:00Z"))).toBe("2026-12-01")
})

test("an expense applied for drops out", () => {
  const c = summariseCaptured(MONTH, [], [e("ex1", "approved", "job1", 6480, "2026-09-12T12:00:00Z")], new Set(["ex1"]))
  expect(c.pence).toBe(0)
})
