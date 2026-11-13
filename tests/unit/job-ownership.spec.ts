import { test, expect } from "@playwright/test"
import { isUuid, ownedJobId } from "../../lib/job-ownership"

const A = "11111111-1111-4111-8111-111111111111"
const B = "22222222-2222-4222-8222-222222222222"
const JOB_A = "aaaaaaaa-0000-4000-8000-000000000001"
const JOB_B = "bbbbbbbb-0000-4000-8000-000000000002"

/** A fake that honours eq() filters, so a missing company filter is caught. */
function fakeService(jobs: Array<{ id: string; company_id: string }>, opts: { error?: boolean } = {}) {
  const calls: string[] = []
  return {
    calls,
    from(table: string) {
      const filters: Record<string, string> = {}
      const q: any = {
        select: () => q,
        eq: (col: string, val: string) => { filters[col] = val; calls.push(`${table}.${col}`); return q },
        maybeSingle: async () => {
          if (opts.error) return { data: null, error: { message: "boom" } }
          const rows = jobs.filter((j) => Object.entries(filters).every(([k, v]) => (j as any)[k] === v))
          return { data: rows[0] || null, error: null }
        },
      }
      return q
    },
  }
}

const jobs = [{ id: JOB_A, company_id: A }, { id: JOB_B, company_id: B }]

test.describe("job ownership before delete", () => {
  test("own job passes", async () => {
    expect(await ownedJobId(fakeService(jobs), JOB_A, A)).toBe(JOB_A)
  })

  test("another company's job is refused", async () => {
    expect(await ownedJobId(fakeService(jobs), JOB_B, A)).toBeNull()
  })

  test("a job that does not exist is refused the same way", async () => {
    expect(await ownedJobId(fakeService(jobs), "cccccccc-0000-4000-8000-000000000003", A)).toBeNull()
  })

  test("the query is filtered by company, not just id", async () => {
    const s = fakeService(jobs)
    await ownedJobId(s, JOB_A, A)
    expect(s.calls).toContain("jobs.company_id")
  })

  test("a query builder that ignores filters still cannot pass another company's job", async () => {
    const leaky = { from: () => { const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: jobs[1], error: null }) }; return q } }
    expect(await ownedJobId(leaky, JOB_A, A)).toBeNull()
  })

  test("garbage ids, missing company and database errors are refused", async () => {
    for (const bad of [undefined, null, "", "not-a-uuid", 42, { id: JOB_A }, [JOB_A], `${JOB_A}' or '1'='1`]) {
      expect(await ownedJobId(fakeService(jobs), bad, A)).toBeNull()
    }
    expect(await ownedJobId(fakeService(jobs), JOB_A, null)).toBeNull()
    expect(await ownedJobId(fakeService(jobs), JOB_A, "")).toBeNull()
    expect(await ownedJobId(fakeService(jobs, { error: true }), JOB_A, A)).toBeNull()
  })

  test("isUuid", () => {
    expect(isUuid(JOB_A)).toBe(true)
    expect(isUuid(JOB_A.toUpperCase())).toBe(true)
    expect(isUuid(JOB_A + "x")).toBe(false)
  })
})
