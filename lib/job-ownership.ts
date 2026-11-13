// lib/job-ownership.ts
//
// Kept as the name /api/jobs/delete imports. The check lives in lib/ownership.ts.

import { ownedId } from "./ownership"

export { isUuid } from "./ownership"

/** The job's id if it exists AND belongs to companyId, otherwise null. */
export function ownedJobId(service: any, jobId: unknown, companyId: string | null | undefined) {
  return ownedId(service, "jobs", jobId, companyId)
}
