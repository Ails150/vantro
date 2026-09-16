import { test, expect } from "@playwright/test"
import { login } from "./helpers"

/**
 * The Xero timesheet export is idempotent per company per week.
 *
 * This is the one property that matters: two timesheets for the same employee
 * and the same week is a double payment. An admin who corrects a shift and
 * re-exports is doing something entirely reasonable, so the second export has
 * to land on the first one rather than beside it.
 *
 * A fixed week in the past is used rather than "this week" so the assertions do
 * not depend on who happened to be on site while the suite ran. The export row
 * it creates is itself idempotent, so re-running the suite reuses the same row
 * instead of accumulating them -- which is, conveniently, the thing under test.
 */
const WEEK_START = "2026-01-05" // a Monday
const MID_WEEK = "2026-01-08" // the Thursday of that same week

test.describe("xero export", () => {
  test("re-exporting a week updates the timesheet and never creates a second", async ({ page }) => {
    test.setTimeout(120_000)
    await login(page)

    // First export. Creates the week's timesheet.
    const first = await page.request.post("/api/payroll/xero", {
      data: { weekStart: WEEK_START },
    })
    expect(first.ok(), `first export failed: ${await first.text()}`).toBeTruthy()
    const firstId = first.headers()["x-export-id"]
    expect(firstId, "export should return its record id").toBeTruthy()
    expect(first.headers()["x-week-start"]).toBe(WEEK_START)

    // Second export of the same week. Must reuse the same record.
    const second = await page.request.post("/api/payroll/xero", {
      data: { weekStart: WEEK_START },
    })
    expect(second.ok(), `second export failed: ${await second.text()}`).toBeTruthy()
    expect(
      second.headers()["x-export-id"],
      "re-exporting a week must update the existing timesheet, not create a second",
    ).toBe(firstId)

    // Any day in the week means the same week. "Export the week containing
    // Thursday" must not be able to produce a separate timesheet.
    const midWeek = await page.request.post("/api/payroll/xero", {
      data: { weekStart: MID_WEEK },
    })
    expect(midWeek.ok(), `mid-week export failed: ${await midWeek.text()}`).toBeTruthy()
    expect(midWeek.headers()["x-week-start"], "a mid-week date snaps to its Monday").toBe(WEEK_START)
    expect(
      midWeek.headers()["x-export-id"],
      "a mid-week date must reach the same timesheet as its Monday",
    ).toBe(firstId)

    // And the database agrees: exactly one row for this company and week.
    const listed = await page.request.get(`/api/payroll/xero?weekStart=${WEEK_START}`)
    expect(listed.ok()).toBeTruthy()
    const body = await listed.json()
    expect(body.exports, "exactly one export row for the week").toHaveLength(1)
    expect(body.exports[0].id).toBe(firstId)
    expect(body.exports[0].xero_timesheet_ref).toBe("VTR-TS-20260105")
  })

  test("the timesheet carries pay, not just hours", async ({ page }) => {
    test.setTimeout(120_000)
    await login(page)

    const res = await page.request.post("/api/payroll/xero", { data: { weekStart: WEEK_START } })
    expect(res.ok()).toBeTruthy()
    expect(res.headers()["content-type"]).toContain("text/csv")

    const text = await res.text()
    const header = text.split(String.fromCharCode(10))[0]

    expect(header).toContain("Employee")
    expect(header).toContain("Earnings Rate")

    // The export used to be hours only, under one "Ordinary Hours" rate, with
    // overtime buried in the totals and no rate anywhere -- so a payroll run
    // computed from it could not reach the figure the app showed. These three
    // columns are what fixed that, and this test exists to keep them.
    expect(header, "the rate and amount columns are gone again").toContain("Hours")
    expect(header).toContain("Rate")
    expect(header).toContain("Amount")

    // Dated day columns, so whoever opens it can see which week it is.
    expect(header).toContain("Mon 05 Jan")
    expect(header).toContain("Sun 11 Jan")

    // A TOTAL ROW, not a Total column: the file is one line per worker per pay
    // type now, so the week's figure belongs at the bottom rather than beside
    // every line.
    const lines = text.trim().split(String.fromCharCode(10))
    const total = lines[lines.length - 1]
    expect(total, "no TOTAL row at the end of the file").toMatch(/^TOTAL,/)

    // And it must be the sum of the Amount column above it.
    const amountIndex = header.split(",").indexOf("Amount")
    expect(amountIndex).toBeGreaterThan(-1)
    const summed = lines
      .slice(1, -1)
      .map(l => Number(l.split(",")[amountIndex] || 0))
      .reduce((a, b) => a + b, 0)
    const stated = Number(total.split(",")[amountIndex] || 0)
    expect(
      Math.round(summed * 100) / 100,
      "the TOTAL row does not equal the lines above it",
    ).toBe(stated)
  })

  test("a malformed week is refused rather than guessed at", async ({ page }) => {
    await login(page)
    const res = await page.request.post("/api/payroll/xero", { data: { weekStart: "last week" } })
    expect(res.status()).toBe(400)
  })
})
