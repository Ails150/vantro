// lib/plan.ts
// The only place that decides what a company can do.
//
// Every gate in the web app, every admin tab and every mobile screen resolves
// through can(). Nothing should read companies.plan directly and nothing should
// branch on a Stripe field: entitlement drifted apart from billing once already
// (ai_audit_enabled could be true with no subscription behind it), and a single
// predicate is what stops it happening again.

export type Plan = "free" | "payroll" | "suite"

export const PLANS: Plan[] = ["free", "payroll", "suite"]

/** Ranked, so "at least payroll" is expressible without listing plans. */
const RANK: Record<Plan, number> = { free: 0, payroll: 1, suite: 2 }

export type Feature =
  // --- Free ---------------------------------------------------------------
  /** Today's board. Every plan has it; a company with no board has no product. */
  | "today"
  /**
   * Sign in is refused outside the site boundary.
   *
   * Free, and the ONLY way a free worker signs in. An attendance record that
   * can be typed from the van is not worth keeping, so free gets the enforced
   * version rather than a weaker one -- what a paid plan adds is what you can
   * do with the hours afterwards, not whether they are true.
   */
  | "geofence"
  /** Invite a worker and let them in from the link. */
  | "workerInvite"
  // --- Payroll ------------------------------------------------------------
  /**
   * Sign in and out typed by hand, with no location check.
   *
   * Paid, and deliberately the wrong way round from how it looks: this is the
   * override for when GPS will not fix or a site sits underground, and it puts
   * an unverified row in the payroll export. That belongs with the plans that
   * have an audit trail to explain it.
   */
  | "manualSignInOut"
  /** Scan a site code to sign in, and show a worker code. */
  | "qr"
  /** Hours export, rates, overtime. */
  | "payrollExport"
  /** Expenses and receipts. */
  | "expenses"
  /** Scheduler, calendar and time off. */
  | "scheduling"
  /** Retention beyond the free window. */
  | "fullHistory"
  // --- Suite --------------------------------------------------------------
  /** Signed compliance packs and the verify endpoint. */
  | "auditPack"
  /** AI narrative, exec summary and red flags inside a pack. */
  | "aiAudit"
  /** Defects, QA reviews and sign-off. */
  | "quality"
  /** Site diary with AI classification. */
  | "diary"
  /** Voice walkthroughs. */
  | "walkthroughs"
  /** Subcontractor records and compliance. */
  | "subcontractors"

/** The lowest plan that includes each feature. */
const MINIMUM: Record<Feature, Plan> = {
  today: "free",
  geofence: "free",
  workerInvite: "free",

  manualSignInOut: "payroll",
  qr: "payroll",
  payrollExport: "payroll",
  expenses: "payroll",
  scheduling: "payroll",
  fullHistory: "payroll",

  auditPack: "suite",
  aiAudit: "suite",
  quality: "suite",
  diary: "suite",
  walkthroughs: "suite",
  subcontractors: "suite",
}

/**
 * How many days of shift history a plan keeps.
 *
 * Free is deliberately short and is enforced by a nightly job that deletes
 * older rows, not merely hidden in the UI: "we still have your data but will
 * not show it to you" is a worse offer than a stated retention window, and it
 * leaves us holding records nobody is paying to store.
 */
export const HISTORY_DAYS: Record<Plan, number | null> = {
  free: 5,
  payroll: null, // null = kept indefinitely
  suite: null,
}

/** Coerce anything read from the database into a Plan. */
export function toPlan(value: unknown): Plan {
  return value === "payroll" || value === "suite" ? value : "free"
}

/** Does this plan include this feature? */
export function can(plan: Plan | null | undefined, feature: Feature): boolean {
  return RANK[toPlan(plan)] >= RANK[MINIMUM[feature]]
}

/** The plan someone must be on to get this feature, for upgrade prompts. */
export function requiredPlan(feature: Feature): Plan {
  return MINIMUM[feature]
}

/** True if `plan` is at least `minimum`. */
export function atLeast(plan: Plan | null | undefined, minimum: Plan): boolean {
  return RANK[toPlan(plan)] >= RANK[minimum]
}

/** Retention in days, or null for indefinite. */
export function historyDays(plan: Plan | null | undefined): number | null {
  return HISTORY_DAYS[toPlan(plan)]
}

/**
 * Admin tab id -> the feature that unlocks it.
 *
 * Tabs not listed here are available on every plan. Keeping this next to the
 * feature table means adding a tab forces a decision about who can see it,
 * rather than defaulting to everyone by omission somewhere in the nav file.
 */
export const TAB_FEATURE: Record<string, Feature> = {
  payroll: "payrollExport",
  expenses: "expenses",
  schedule: "scheduling",
  calendar: "scheduling",
  audit: "auditPack",
  defects: "quality",
  approvals: "quality",
  progress: "quality",
  diary: "diary",
  walkthroughs: "walkthroughs",
  subcontractors: "subcontractors",
}

export function canSeeTab(plan: Plan | null | undefined, tabId: string): boolean {
  const feature = TAB_FEATURE[tabId]
  return feature ? can(plan, feature) : true
}
