import { test, expect } from "@playwright/test"
import { clearSnapshotsForWorker, xeroExportState } from "../../lib/payroll-timesheet"

/** Records what the function asks the database for. */
function fake(opts: { shifts: Array<{ signed_in_at: string }>; readError?: boolean; writeError?: boolean; clearedPerCall?: number }) {
  const updates: Array<{ patch: any; eqs: Record<string, any>; weeks: string[]; notNull: string | null }> = []
  const reads: Record<string, any>[] = []
  return {
    updates, reads,
    from(table: string) {
      const eqs: Record<string, any> = {}
      let patch: any = null, weeks: string[] = [], notNull: string | null = null
      const q: any = {
        select: () => q,
        eq: (c: string, v: any) => { eqs[c] = v; return q },
        in: (_c: string, v: string[]) => { weeks = v; return q },
        not: (c: string) => { notNull = c; return q },
        limit: () => q,
        update: (p: any) => { patch = p; return q },
        then: (resolve: any) => {
          if (table === "signins") {
            reads.push({ ...eqs })
            return resolve(opts.readError ? { data: null, error: { message: "read boom" } } : { data: opts.shifts, error: null })
          }
          updates.push({ patch, eqs: { ...eqs }, weeks, notNull })
          if (opts.writeError) return resolve({ data: null, error: { message: "write boom" } })
          return resolve({ data: Array.from({ length: opts.clearedPerCall ?? weeks.length }, (_, i) => ({ id: `r${i}` })), error: null })
        },
      }
      return q
    },
  }
}

test.describe("erasure clears frozen Xero timesheets", () => {
  test("clears each approved week the worker has shifts in, for this company only", async () => {
    const s = fake({ shifts: [
      { signed_in_at: "2026-11-02T08:00:00Z" }, // Mon
      { signed_in_at: "2026-11-05T08:00:00Z" }, // same week
      { signed_in_at: "2026-11-10T08:00:00Z" }, // next week
    ] })
    const n = await clearSnapshotsForWorker(s, "co-1", "user-1")
    expect(n).toBe(2)
    expect(s.reads[0]).toEqual({ company_id: "co-1", user_id: "user-1" })
    expect(s.updates).toHaveLength(1)
    const u = s.updates[0]
    expect(u.eqs).toEqual({ company_id: "co-1" })
    expect(u.weeks.sort()).toEqual(["2026-11-02", "2026-11-09"])
    expect(u.notNull).toBe("xero_snapshot")
    expect(u.patch.xero_snapshot).toBeNull()
    expect(u.patch.xero_snapshot_cleared_reason).toBe("erasure")
    expect(typeof u.patch.xero_snapshot_cleared_at).toBe("string")
  })

  test("a shift late on Sunday in London belongs to that week, not the next", async () => {
    // 23:30 BST on Sunday 1 Nov is 22:30Z -- but GMT applies by then, so use a
    // summer date: Sunday 26 Oct 2026 is the day the clocks go back. Take
    // Sunday 18 Oct 23:30 BST = 22:30Z, whose week starts Monday 12 Oct.
    const s = fake({ shifts: [{ signed_in_at: "2026-10-18T22:30:00Z" }] })
    await clearSnapshotsForWorker(s, "co-1", "user-1")
    expect(s.updates[0].weeks).toEqual(["2026-10-12"])
  })

  test("no shifts means nothing to clear and no write", async () => {
    const s = fake({ shifts: [] })
    expect(await clearSnapshotsForWorker(s, "co-1", "user-1")).toBe(0)
    expect(s.updates).toHaveLength(0)
  })

  test("many weeks are written in chunks", async () => {
    const shifts = Array.from({ length: 450 }, (_, i) => ({ signed_in_at: new Date(Date.UTC(2020, 0, 6) + i * 7 * 86400000).toISOString() }))
    const s = fake({ shifts })
    await clearSnapshotsForWorker(s, "co-1", "user-1")
    expect(s.updates.map(u => u.weeks.length)).toEqual([200, 200, 50])
  })

  test("a read or write error throws, so the caller cannot report the person erased", async () => {
    await expect(clearSnapshotsForWorker(fake({ shifts: [], readError: true }), "c", "u")).rejects.toThrow(/could not read shifts/)
    await expect(clearSnapshotsForWorker(fake({ shifts: [{ signed_in_at: "2026-11-02T08:00:00Z" }], writeError: true }), "c", "u")).rejects.toThrow(/could not clear/)
  })

  test("the export says why a cleared week has no file", () => {
    const s = xeroExportState({ approved_at: "2026-11-09T10:00:00Z", xero_snapshot: null, xero_snapshot_cleared_reason: "erasure" })
    expect(s.ok).toBe(false)
    if (!s.ok) expect(s.error).toMatch(/erased/)
    const old = xeroExportState({ approved_at: "2026-11-09T10:00:00Z", xero_snapshot: null })
    if (!old.ok) expect(old.error).toMatch(/before weeks were locked/)
  })
})
