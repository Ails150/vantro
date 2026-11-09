import { test, expect } from "@playwright/test"
import {
  benchmark,
  canSeeBenchmark,
  isExcludedCompany,
  median,
  payrollLine,
  payrollLineForReport,
  weekStartFor,
  workersInWeek,
  type BenchmarkCompany,
  type BenchmarkRun,
  type PayrollRun,
} from "../../lib/payroll-runs"

const approved = (over: Partial<PayrollRun> = {}): PayrollRun => ({
  week_start: "2026-11-02", opened_at: "2026-11-06T16:00:00Z", approved_at: "2026-11-06T16:22:00Z",
  workers_count: 14, minutes_taken: 22, ...over,
})

test.describe("the line", () => {
  test("reads the way the brief wrote it", () => {
    expect(payrollLine(approved(), "This week")).toBe("This week's payroll took 22 minutes for 14 workers.")
  })
  test("one minute, one worker", () => {
    expect(payrollLine(approved({ minutes_taken: 1, workers_count: 1 }), "Last week")).toBe("Last week's payroll took 1 minute for 1 worker.")
  })
  test("an open week has no line", () => {
    expect(payrollLine(approved({ approved_at: null, minutes_taken: null, workers_count: null }), "This week")).toBeNull()
    expect(payrollLine(null, "This week")).toBeNull()
  })
})

test.describe("which week", () => {
  test("Monday to Sunday in London, across the clocks changing", () => {
    expect(weekStartFor("this_week", new Date("2026-11-09T14:00:00Z"))).toBe("2026-11-09")
    expect(weekStartFor("last_week", new Date("2026-11-09T14:00:00Z"))).toBe("2026-11-02")
    expect(weekStartFor("this_week", new Date("2026-11-08T23:30:00Z"))).toBe("2026-11-02")
    // 23:30 UTC on a Sunday in BST is already Monday in London.
    expect(weekStartFor("this_week", new Date("2026-06-14T23:30:00Z"))).toBe("2026-06-15")
    expect(weekStartFor("last_week", new Date("2026-10-26T12:00:00Z"))).toBe("2026-10-19")
  })
})

function fakeService(rows: any[], error: any = null) {
  const q: any = {
    select: () => q, eq: () => q, gte: () => q, lt: () => q, not: () => q, in: () => q, limit: () => q,
    then: (r: any) => r({ data: rows, error }),
  }
  return { from: () => q }
}

test.describe("who counts", () => {
  test("each field worker once, nobody else", async () => {
    const n = await workersInWeek(fakeService([
      { user_id: "a", users: { role: "installer" } },
      { user_id: "a", users: { role: "installer" } },
      { user_id: "b", users: { role: "field" } },
      { user_id: "boss", users: { role: "admin" } },
      { user_id: "f", users: { role: "foreman" } },
    ]), "c", "2026-11-02")
    expect(n).toBe(2)
  })
})

test.describe("the Friday PDF", () => {
  test("prefers this week, then falls back to last week", async () => {
    const both = [approved({ week_start: "2026-11-09", minutes_taken: 9 }), approved()]
    expect(await payrollLineForReport(fakeService(both), "c", "2026-11-09")).toBe("This week's payroll took 9 minutes for 14 workers.")
    expect(await payrollLineForReport(fakeService([approved()]), "c", "2026-11-09")).toBe("Last week's payroll took 22 minutes for 14 workers.")
  })
  test("nothing approved means no line", async () => {
    expect(await payrollLineForReport(fakeService([]), "c", "2026-11-09")).toBeNull()
  })
  test("a read failure costs the line, never the report", async () => {
    expect(await payrollLineForReport(fakeService([], { message: "boom" }), "c", "2026-11-09")).toBeNull()
  })
})

test.describe("the median", () => {
  const real = (n: number): BenchmarkCompany[] => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, name: `Real Roofing ${i}` }))
  const run = (company_id: string, minutes_taken: number): BenchmarkRun => ({ company_id, minutes_taken, workers_count: 5, approved_at: "2026-11-06T16:00:00Z" })

  test("odd, even and empty", () => {
    expect(median([30, 10, 20])).toBe(20)
    expect(median([10, 20, 30, 40])).toBe(25)
    expect(median([])).toBeNull()
  })

  test("demo and test companies are left out", () => {
    for (const n of ["Apexify Agency", "Northbridge Glazing Ltd", "[TEST] Crescent Glazing", "[test] x"]) expect(isExcludedCompany(n), n).toBe(true)
    for (const n of ["I-Glaze Limited", "Testwood Roofing", "North Bridge Roofing"]) expect(isExcludedCompany(n), n).toBe(false)
  })

  test("nine companies: no number at all", () => {
    const cos = real(9)
    const b = benchmark(cos, cos.map(c => run(c.id, 20)))
    expect(b.companiesCounted).toBe(9)
    expect(b.medianMinutes).toBeNull()
  })

  test("ten companies: the median", () => {
    const cos = real(10)
    const b = benchmark(cos, cos.map((c, i) => run(c.id, 10 + i * 2)))
    expect(b.medianMinutes).toBe(19)
  })

  test("today's shape: eleven test companies and two demos do not reach the bar", () => {
    const cos: BenchmarkCompany[] = [
      ...Array.from({ length: 11 }, (_, i) => ({ id: `t${i}`, name: `[TEST] Co ${i}` })),
      { id: "a", name: "Apexify Agency" }, { id: "n", name: "Northbridge Glazing Ltd" },
    ]
    const b = benchmark(cos, cos.map(c => run(c.id, 20)))
    expect(b.companiesCounted).toBe(0)
    expect(b.companiesExcluded).toBe(13)
    expect(b.medianMinutes).toBeNull()
  })

  test("a company with many weeks counts once", () => {
    const cos = real(10)
    const runs = cos.map(c => run(c.id, 20))
    for (let i = 0; i < 100; i++) runs.push(run("r0", 500))
    expect(benchmark(cos, runs).medianMinutes).toBe(20)
  })

  test("open weeks are not counted", () => {
    const cos = real(1)
    expect(benchmark(cos, [{ company_id: "r0", minutes_taken: null, workers_count: null, approved_at: null }]).runsCounted).toBe(0)
  })
})

test.describe("who can see the median", () => {
  test("only the superadmin at Apexify", () => {
    expect(canSeeBenchmark("superadmin", "Apexify Agency")).toBe(true)
    expect(canSeeBenchmark("admin", "Apexify Agency")).toBe(false)
    expect(canSeeBenchmark("superadmin", "I-Glaze Limited")).toBe(false)
    expect(canSeeBenchmark("support", "Apexify Agency")).toBe(false)
    expect(canSeeBenchmark(null, null)).toBe(false)
  })
})
