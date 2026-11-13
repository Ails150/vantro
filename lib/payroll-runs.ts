// lib/payroll-runs.ts
//
// How long a week's payroll took, one line for the people who ran it and one
// median for us. The Payroll tab and the Friday PDF both print payrollLine, so
// they cannot word it differently.
//
// This measures time TAKEN. There is no "before" figure in here, so it does not
// on its own support a claim about time saved.

import { addDays, isoWeekStart, londonMidnight } from "./format-time"
import { isFieldRole } from "./roles"

export type PayrollWeek = "this_week" | "last_week"

export type PayrollRun = {
  week_start: string
  opened_at: string
  approved_at: string | null
  workers_count: number | null
  minutes_taken: number | null
}

export function toPayrollWeek(value: unknown): PayrollWeek | null {
  return value === "this_week" || value === "last_week" ? value : null
}

export function weekStartFor(week: PayrollWeek, now: Date = new Date()): string {
  const monday = isoWeekStart(now)
  return week === "this_week" ? monday : addDays(monday, -7)
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

/** Null until the week has been approved: an open week has taken no time yet. */
export function payrollLine(run: PayrollRun | null | undefined, label: "This week" | "Last week"): string | null {
  if (!run?.approved_at || !run.minutes_taken || !run.workers_count) return null
  return `${label}'s payroll took ${plural(run.minutes_taken, "minute")} for ${plural(run.workers_count, "worker")}.`
}

/** Is any of these dates in an approved week? Takes dates or timestamps. */
export async function anyWeekLocked(service: any, companyId: string, values: string[]): Promise<boolean> {
  const weeks = [...new Set(values.map(v => isoWeekStart(v.length === 10 ? londonMidnight(v) : v)))]
  if (weeks.length === 0) return false
  const { data, error } = await service
    .from("payroll_runs")
    .select("id")
    .eq("company_id", companyId)
    .in("week_start", weeks)
    .not("approved_at", "is", null)
    .limit(1)
  if (error) throw new Error(`week lock: ${error.message}`)
  return (data || []).length > 0
}

export const WEEK_LOCKED_MESSAGE = "That week is approved. Unlock it on the Payroll tab to change it."

/** Field workers with at least one finished shift in the week. */
export async function workersInWeek(service: any, companyId: string, weekStart: string): Promise<number> {
  const { data, error } = await service
    .from("signins")
    .select("user_id, users:user_id (role)")
    .eq("company_id", companyId)
    .gte("signed_in_at", londonMidnight(weekStart).toISOString())
    .lt("signed_in_at", londonMidnight(addDays(weekStart, 7)).toISOString())
    .not("signed_out_at", "is", null)
    .limit(20000)
  if (error) throw new Error(`workers in week: ${error.message}`)
  const people = new Set<string>()
  for (const row of data || []) {
    if (isFieldRole(row.users?.role)) people.add(row.user_id)
  }
  return people.size
}

/**
 * The line for the Friday PDF.
 *
 * Friday at 5pm usually comes before this week has been approved, so it falls
 * back to last week's. Never throws: a report must not fail over one line.
 */
export async function payrollLineForReport(service: any, companyId: string, weekStart: string): Promise<string | null> {
  try {
    const lastWeek = addDays(weekStart, -7)
    const { data, error } = await service
      .from("payroll_runs")
      .select("week_start, opened_at, approved_at, workers_count, minutes_taken")
      .eq("company_id", companyId)
      .in("week_start", [weekStart, lastWeek])
      .not("approved_at", "is", null)
    if (error) throw new Error(error.message)
    const find = (week: string) => (data || []).find((r: PayrollRun) => r.week_start === week)
    return payrollLine(find(weekStart), "This week") || payrollLine(find(lastWeek), "Last week")
  } catch (e: any) {
    console.error("[payroll-runs] report line skipped", companyId, e?.message)
    return null
  }
}

// ---------------------------------------------------------------------------
// The median, for the platform owner only
// ---------------------------------------------------------------------------

export const BENCHMARK_MINIMUM_COMPANIES = 10

// Matched on name because the demo tenant is rebuilt with a new id each reseed.
const EXCLUDED_NAMES = [/^apexify\b/i, /^northbridge glazing\b/i, /^\s*\[test\]/i]

/** Demo and test companies. Their numbers must never reach an advert. */
export function isExcludedCompany(name: string | null | undefined): boolean {
  return EXCLUDED_NAMES.some(p => p.test(name || ""))
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export type BenchmarkCompany = { id: string; name: string }
export type BenchmarkRun = { company_id: string; minutes_taken: number | null; workers_count: number | null; approved_at: string | null }

export type Benchmark = {
  companiesCounted: number
  companiesNeeded: number
  companiesExcluded: number
  runsCounted: number
  /** Null until there are enough companies. Withheld, not just hidden. */
  medianMinutes: number | null
}

/**
 * The median of each company's own median, so one company that has run payroll
 * for two years counts the same as one that has run it for two months.
 */
export function benchmark(companies: BenchmarkCompany[], runs: BenchmarkRun[]): Benchmark {
  const excluded = new Set(companies.filter(c => isExcludedCompany(c.name)).map(c => c.id))
  const known = new Set(companies.map(c => c.id))
  const byCompany = new Map<string, number[]>()
  let runsCounted = 0
  for (const r of runs) {
    if (!r.approved_at || !r.minutes_taken || !r.workers_count) continue
    if (!known.has(r.company_id) || excluded.has(r.company_id)) continue
    byCompany.set(r.company_id, [...(byCompany.get(r.company_id) || []), r.minutes_taken])
    runsCounted += 1
  }
  const companyMedians = [...byCompany.values()].map(v => median(v) as number)
  const ready = companyMedians.length >= BENCHMARK_MINIMUM_COMPANIES
  return {
    companiesCounted: companyMedians.length,
    companiesNeeded: BENCHMARK_MINIMUM_COMPANIES,
    companiesExcluded: excluded.size,
    runsCounted,
    medianMinutes: ready ? median(companyMedians) : null,
  }
}

/**
 * Superadmin is held by people inside customer companies, so the role alone is
 * not enough for a page of cross-company numbers. It has to be Apexify's.
 */
export function canSeeBenchmark(role: string | null | undefined, companyName: string | null | undefined): boolean {
  return role === "superadmin" && /^apexify\b/i.test(companyName || "")
}
