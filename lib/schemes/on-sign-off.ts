// lib/schemes/on-sign-off.ts
//
// Called once a job has been marked complete. It never throws: the sign-off has
// already happened and stands. Anything that goes wrong here leaves the job
// pending or failed, and Today lists both.

import { registerJob, type RegisterOutcome } from "./register"
import { supabaseSchemeStore } from "./store"

export async function registerOnSignOff(
  service: any,
  companyId: string,
  jobId: string,
  actorUserId: string | null,
): Promise<RegisterOutcome | { status: "error"; reason: string }> {
  try {
    return await registerJob({ store: supabaseSchemeStore(service) }, { companyId, jobId, actorUserId })
  } catch (e: any) {
    console.error("[schemes] registration after sign-off did not finish", jobId, e?.message)
    return { status: "error", reason: "Registration did not finish. It is on Today." }
  }
}
