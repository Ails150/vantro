import { test, expect } from "@playwright/test"
import { anyWeekLocked, WEEK_LOCKED_MESSAGE } from "../../lib/payroll-runs"
import { buildWeekTimesheet, timesheetRef, xeroExportState } from "../../lib/payroll-timesheet"

/**
 * The lock itself is SQL and is exercised against the migration. This covers
 * what the routes decide around it.
 */

function fakeService(tables: Record<string, any[]>) {
  return {
    from(table: string) {
      const rows = tables[table] || []
      const q: any = {
        select: () => q, eq: () => q, gte: () => q, lt: () => q, not: () => q, in: () => q, limit: () => q, order: () => q,
        maybeSingle: async () => ({ data: rows[0] || null, error: null }),
        single: async () => ({ data: rows[0] || null, error: null }),
        then: (r: any) => r({ data: rows, error: null }),
      }
      return q
    },
  }
}

const week = "2026-11-02"
const tables = (rate: number) => ({
  signins: [
    { id: "s1", user_id: "w1", signed_in_at: "2026-11-02T08:00:00Z", signed_out_at: "2026-11-02T16:00:00Z", hours_worked: 8, users: { id: "w1", name: "Pete Walker", email: "pete@example.com" } },
    { id: "s2", user_id: "w1", signed_in_at: "2026-11-03T08:00:00Z", signed_out_at: "2026-11-03T16:00:00Z", hours_worked: 8, users: { id: "w1", name: "Pete Walker", email: "pete@example.com" } },
  ],
  companies: [{ id: "c", country_code: "GB", default_hourly_rate: null }],
  users: [{ id: "w1", name: "Pete Walker", email: "pete@example.com", hourly_rate: rate }],
})

test.describe("the frozen timesheet", () => {
  test("carries hours, pay and the reference", async () => {
    const s = await buildWeekTimesheet(fakeService(tables(20)), "c", week)
    expect(s.ref).toBe(timesheetRef(week))
    expect(s.ref).toBe("VTR-TS-20261102")
    expect(s.totalHours).toBe(16)
    expect(s.totalPay).toBe(320)
    expect(s.employeeCount).toBe(1)
    expect(s.csv).toContain("Pete Walker")
  })

  test("a rate change after approval does not reach what was frozen", async () => {
    const frozen = await buildWeekTimesheet(fakeService(tables(20)), "c", week)
    const stored = JSON.parse(JSON.stringify(frozen))
    const afterRise = await buildWeekTimesheet(fakeService(tables(25)), "c", week)
    expect(afterRise.totalPay).toBe(400)
    expect(stored.totalPay).toBe(320)
    expect(stored.csv).toBe(frozen.csv)
  })
})

test.describe("what can go to Xero", () => {
  test("only an approved, frozen week", () => {
    expect(xeroExportState({ approved_at: "2026-11-09T10:00:00Z", xero_snapshot: { csv: "x" } })).toEqual({ ok: true })
  })
  test("never an unapproved week, a missing week or an unlocked one", () => {
    expect(xeroExportState(null).ok).toBe(false)
    expect(xeroExportState({ approved_at: null, xero_snapshot: null }).ok).toBe(false)
  })
  test("a week approved before locks existed has to be approved again", () => {
    const s = xeroExportState({ approved_at: "2026-11-09T10:00:00Z", xero_snapshot: null })
    expect(s.ok).toBe(false)
    expect((s as any).error).toContain("Unlock it and approve it again")
  })
})

test.describe("the check bonuses and job delete use", () => {
  test("a date or a shift in an approved week is locked", async () => {
    const locked = fakeService({ payroll_runs: [{ id: "r" }] })
    expect(await anyWeekLocked(locked, "c", ["2026-11-04"])).toBe(true)
    expect(await anyWeekLocked(locked, "c", ["2026-11-04T09:00:00Z"])).toBe(true)
  })
  test("no approved week, or nothing to check, is not locked", async () => {
    expect(await anyWeekLocked(fakeService({ payroll_runs: [] }), "c", ["2026-11-04"])).toBe(false)
    expect(await anyWeekLocked(fakeService({ payroll_runs: [{ id: "r" }] }), "c", [])).toBe(false)
  })
  test("the message tells them what to do", () => {
    expect(WEEK_LOCKED_MESSAGE).toContain("Unlock it on the Payroll tab")
  })
})
