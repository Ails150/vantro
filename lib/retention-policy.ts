// lib/retention-policy.ts
//
// How long a company keeps its records, and when the first purge falls.
//
// Pure. The dates that decide whether records are destroyed are worked out
// here, away from the job that does the destroying, so they can be tested
// against a table rather than reasoned about once.

/** Days in the offered options. */
export const THREE_YEARS = 1095
export const SIX_YEARS = 2190

/**
 * The grace between choosing a policy and the first purge under it.
 *
 * Thirty days, and it is the whole safety mechanism. Choosing "3 years" on a
 * company with four years of history would otherwise destroy a year of records
 * the next time a nightly job ran. Somebody who picks the wrong option gets a
 * month and a banner to notice.
 */
export const RETENTION_GRACE_DAYS = 30

/** How close to the first purge the banner starts. Same window: it is on from
 *  the moment the policy is set until the purge happens. */
export const RETENTION_WARNING_DAYS = RETENTION_GRACE_DAYS

export type RetentionOption = {
  days: number | null
  label: string
  detail: string
}

/**
 * What the settings screen offers.
 *
 * Nothing shorter than three years, deliberately. Health and safety records
 * carry their own statutory minimums, and a subcontractor deleting attendance
 * at twelve months has destroyed their own defence in a dispute they do not
 * know is coming.
 */
export const RETENTION_OPTIONS: RetentionOption[] = [
  {
    days: null,
    label: "Keep for ever",
    detail: "Nothing is deleted. This is the default.",
  },
  {
    days: THREE_YEARS,
    label: "3 years",
    detail: "Long enough for most commercial disputes.",
  },
  {
    days: SIX_YEARS,
    label: "6 years",
    detail:
      "The Limitation Act 1980 allows six years to bring an action on a simple " +
      "contract, so this is the span you could still be sued across.",
  },
]

export type RetentionState = {
  /** Null means keep for ever. */
  retentionDays: number | null
  /** True when a purge would delete something under this policy. */
  active: boolean
  /** When the first purge under the current policy may run. Null if never. */
  firstPurgeAt: Date | null
  /** Whole days until that, negative once it has passed. Null if never. */
  daysUntilFirstPurge: number | null
  /** True while the banner should be shown. */
  warn: boolean
  /** Records older than this are deleted once the grace has passed. */
  cutoff: Date | null
}

/**
 * Resolve a company's retention position.
 *
 * `setAt` is companies.retention_policy_set_at. Null with a retention set means
 * a policy arrived without a timestamp -- a hand edit, or an import -- and is
 * treated as NOT YET IN GRACE rather than as due immediately. Deleting records
 * because a timestamp was missing is the wrong way to resolve an ambiguity.
 */
export function retentionState(
  retentionDays: number | null | undefined,
  setAt: string | Date | null | undefined,
  now: Date = new Date(),
): RetentionState {
  const days =
    retentionDays === null || retentionDays === undefined || !Number.isFinite(Number(retentionDays))
      ? null
      : Math.trunc(Number(retentionDays))

  if (days === null || days <= 0) {
    return {
      retentionDays: null,
      active: false,
      firstPurgeAt: null,
      daysUntilFirstPurge: null,
      warn: false,
      cutoff: null,
    }
  }

  const setAtDate = setAt ? new Date(setAt) : null
  const hasValidSetAt = setAtDate !== null && Number.isFinite(setAtDate.getTime())

  // A policy with no timestamp cannot start its grace period, so it never
  // becomes due. It shows in the UI and purges nothing until somebody saves it
  // again, which stamps the column.
  const firstPurgeAt = hasValidSetAt
    ? new Date(setAtDate!.getTime() + RETENTION_GRACE_DAYS * 86400000)
    : null

  const daysUntilFirstPurge = firstPurgeAt
    ? Math.ceil((firstPurgeAt.getTime() - now.getTime()) / 86400000)
    : null

  const gracePassed = firstPurgeAt !== null && now.getTime() >= firstPurgeAt.getTime()

  return {
    retentionDays: days,
    active: gracePassed,
    firstPurgeAt,
    daysUntilFirstPurge,
    // Shown from the moment the policy is set until the first purge runs.
    warn: firstPurgeAt !== null && !gracePassed,
    cutoff: new Date(now.getTime() - days * 86400000),
  }
}

/** A label for the banner and the settings screen. */
export function retentionLabel(retentionDays: number | null | undefined): string {
  const match = RETENTION_OPTIONS.find(o => o.days === (retentionDays ?? null))
  if (match) return match.label
  const days = Number(retentionDays)
  if (!Number.isFinite(days)) return "Keep for ever"
  // A value set by hand rather than chosen from the list.
  const years = days / 365
  return years >= 1 ? `${Math.round(years * 10) / 10} years` : `${days} days`
}

/** Is this a value the settings screen is allowed to save? */
export function isValidRetentionDays(raw: unknown): boolean {
  if (raw === null || raw === undefined || raw === "") return true // for ever
  const n = Number(raw)
  if (!Number.isInteger(n)) return false
  // Matches the check constraint in 20260916120000_retention_policy.sql. The
  // bounds are wider than the three options so a hand-set value is not broken
  // by a save from the UI.
  return n >= 30 && n <= 36500
}

/**
 * Tables a purge sweeps, and the timestamp column it measures age by.
 *
 * Written out rather than discovered. A table missing from this list is kept
 * for ever regardless of the policy, which is a promise quietly broken, so
 * tests/unit/retention-policy.spec.ts pins the list.
 *
 * DELIBERATELY ABSENT:
 *   users, companies, jobs, sites      records, not events. Deleting a job
 *                                      because it is old would orphan
 *                                      everything still pointing at it.
 *   audit_packs, evidence_hashes       the integrity chain. A pack issued to a
 *                                      client must stay verifiable, and its
 *                                      hashes are what make it so.
 *   retention_purges                   the record of what a purge destroyed.
 *   data_subject_requests              the Article 30 accountability log.
 *   pay_rules, pay_bonuses             payroll, with its own retention duty.
 */
export const PURGE_TABLES: Array<{ table: string; column: string }> = [
  { table: "location_logs", column: "logged_at" },
  { table: "signins", column: "signed_in_at" },
  { table: "diary_entries", column: "created_at" },
  { table: "qa_submissions", column: "created_at" },
  { table: "defects", column: "created_at" },
  { table: "incidents", column: "reported_at" },
  { table: "walkthroughs", column: "created_at" },
  { table: "variations", column: "created_at" },
  { table: "toolbox_talk_signatures", column: "signed_at" },
  { table: "rams_signatures", column: "signed_at" },
  { table: "alerts", column: "created_at" },
  { table: "notification_log", column: "created_at" },
  { table: "audit_log", column: "created_at" },
]
