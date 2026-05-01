// lib/staffing.ts
//
// Staffing detection: given a company's jobs, users, and assignments,
// compute per-job staffing status by comparing required trades against
// the union of trades held by assigned installers.
//
// Status meanings:
//   "covered"     - every required trade is held by at least one assigned installer
//   "partial"     - some required trades are covered, others are not
//   "missing"     - no assigned installer covers ANY required trade (or no one assigned)
//   "unspecified" - no required_trades set on the job, detection skipped
//
// Pure function. No DB calls. Caller passes the data in. Used by the Jobs
// tab today and the Overview "needs attention" card later.

export type StaffingStatus = "covered" | "partial" | "missing" | "unspecified"

export interface JobStaffingInput {
  id: string
  name: string
  status?: string  // active / pending / completed
  required_trades?: string[] | null
}

export interface UserStaffingInput {
  id: string
  name?: string
  trades?: string[] | null
}

export interface AssignmentInput {
  job_id: string
  user_id: string
}

export interface JobStaffingResult {
  jobId: string
  jobName: string
  status: StaffingStatus
  requiredTrades: string[]
  coveredTrades: string[]
  missingTrades: string[]
  assignedCount: number
  assignedNames: string[]
}

/**
 * Analyse staffing for one job.
 */
export function analyzeJob(
  job: JobStaffingInput,
  users: UserStaffingInput[],
  assignments: AssignmentInput[]
): JobStaffingResult {
  const required = Array.isArray(job.required_trades)
    ? job.required_trades.filter(t => typeof t === "string" && t.trim().length > 0)
    : []

  // Find users assigned to this job
  const assignedUserIds = new Set(
    assignments.filter(a => a.job_id === job.id).map(a => a.user_id)
  )
  const assignedUsers = users.filter(u => assignedUserIds.has(u.id))

  // Union of trades across assigned users
  const coveredSet = new Set<string>()
  for (const u of assignedUsers) {
    if (Array.isArray(u.trades)) {
      for (const t of u.trades) {
        if (typeof t === "string" && t.trim().length > 0) coveredSet.add(t)
      }
    }
  }
  const covered = Array.from(coveredSet)

  // No required_trades set → cannot evaluate
  if (required.length === 0) {
    return {
      jobId: job.id,
      jobName: job.name,
      status: "unspecified",
      requiredTrades: [],
      coveredTrades: covered,
      missingTrades: [],
      assignedCount: assignedUsers.length,
      assignedNames: assignedUsers.map(u => u.name || "Unknown"),
    }
  }

  const missing = required.filter(t => !coveredSet.has(t))

  let status: StaffingStatus
  if (missing.length === 0) status = "covered"
  else if (missing.length === required.length) status = "missing"
  else status = "partial"

  return {
    jobId: job.id,
    jobName: job.name,
    status,
    requiredTrades: required,
    coveredTrades: covered,
    missingTrades: missing,
    assignedCount: assignedUsers.length,
    assignedNames: assignedUsers.map(u => u.name || "Unknown"),
  }
}

/**
 * Analyse staffing for all jobs in a company.
 * Filters out completed/cancelled jobs by default - we only care about
 * staffing for jobs that still need work done.
 */
export function analyzeAllJobs(
  jobs: JobStaffingInput[],
  users: UserStaffingInput[],
  assignments: AssignmentInput[],
  options?: { includeAllStatuses?: boolean }
): JobStaffingResult[] {
  const filtered = options?.includeAllStatuses
    ? jobs
    : jobs.filter(j =>
        !j.status ||
        j.status === "active" ||
        j.status === "pending" ||
        j.status === "scheduled"
      )

  return filtered.map(j => analyzeJob(j, users, assignments))
}

/**
 * Convenience filter: only jobs needing attention (partial or missing).
 * "unspecified" is excluded because we don't know if they're a problem.
 */
export function jobsNeedingAttention(
  results: JobStaffingResult[]
): JobStaffingResult[] {
  return results.filter(r => r.status === "partial" || r.status === "missing")
}

/**
 * Convenience filter: jobs with no required_trades set.
 * Surface these so admins know to configure them.
 */
export function jobsWithUnspecifiedTrades(
  results: JobStaffingResult[]
): JobStaffingResult[] {
  return results.filter(r => r.status === "unspecified")
}

/**
 * Human-readable summary for one job.
 *   covered     -> "Fully staffed"
 *   partial     -> "Missing electrical"  (or "Missing electrical, glazing" for two)
 *   missing     -> "No coverage - needs electrical"  (when nothing assigned)
 *               -> "Missing electrical, glazing"     (when assigned but wrong trades)
 *   unspecified -> "Trades not set"
 */
export function summarizeJobStaffing(r: JobStaffingResult): string {
  if (r.status === "covered") return "Fully staffed"
  if (r.status === "unspecified") return "Trades not set"

  const missingLabel = r.missingTrades.join(", ")
  if (r.status === "partial") return `Missing ${missingLabel}`
  // status === "missing"
  if (r.assignedCount === 0) return `No one assigned - needs ${missingLabel}`
  return `Missing ${missingLabel}`
}