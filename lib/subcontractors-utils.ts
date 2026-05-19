/**
 * Subcontractor cost estimation helpers.
 *
 * Given a rate type + amount + crew hours/days, estimates labour cost.
 * Used by the Subcontractors overview tab and Payroll tab subcontractor section.
 *
 * NOT a billing system. This is for visibility, not invoicing.
 * Liam still receives invoices outside Vantro; this just shows what to expect.
 */

export type RateType = "hourly" | "daily" | "weekly" | "monthly" | "per_job"

interface CostEstimateArgs {
  rateType: RateType
  rateAmount: number
  manHours: number    // total man-hours across all crew on site
  manDays?: number    // optional, derived from manHours / 8 if not supplied
  jobsWorked?: number // for per_job rate type
}

/**
 * Estimate the cost the subcontractor will invoice.
 *
 * - hourly: rate × man-hours
 * - daily:  rate × man-days (rounded up to nearest day per person)
 * - weekly: rate × man-weeks (5 man-days = 1 man-week)
 * - monthly: rate × man-months (~20 man-days = 1 man-month)
 * - per_job: rate × jobs worked
 */
export function estimateSubcontractorCost(args: CostEstimateArgs): number {
  const { rateType, rateAmount, manHours, manDays, jobsWorked } = args
  if (!rateAmount || rateAmount <= 0) return 0

  const derivedManDays = manDays ?? Math.ceil(manHours / 8)

  switch (rateType) {
    case "hourly":
      return rateAmount * manHours
    case "daily":
      return rateAmount * derivedManDays
    case "weekly":
      return rateAmount * (derivedManDays / 5)
    case "monthly":
      return rateAmount * (derivedManDays / 20)
    case "per_job":
      return rateAmount * (jobsWorked ?? 1)
    default:
      return 0
  }
}

/**
 * Format a rate for display: "£180/day", "£25/hour", "£3,500/job"
 */
export function formatRate(rateType: RateType, rateAmount: number, currency = "GBP"): string {
  const symbol = currency === "GBP" ? "£" : currency === "EUR" ? "€" : "$"
  const formatted = rateAmount.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  const unitMap: Record<RateType, string> = {
    hourly: "/hr",
    daily: "/day",
    weekly: "/wk",
    monthly: "/mo",
    per_job: "/job",
  }
  return symbol + formatted + unitMap[rateType]
}
