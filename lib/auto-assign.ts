// lib/auto-assign.ts
//
// One job, one worker, nobody linked: link them.
//
// An unassigned worker is the quietest failure in the product. Their app says
// "Nothing scheduled today. Your next job appears here once it is assigned",
// which is true and useless: nothing tells the office that the person they
// just added cannot see the job they just made. The setup wizard asked for the
// link explicitly, which is why it was never missed -- and why a first run
// needed a matrix screen to join two rows.
//
// So when there is exactly one of each and no assignment at all, the answer is
// not ambiguous and there is nothing to choose. Two jobs, or two workers, and
// it stops: guessing which crew belongs on which site is the office's job, and
// a wrong guess there hides work from the person who should be doing it.

import { FIELD_FOREMAN_SUBBIE } from "./roles"

export type AutoAssignCounts = {
  activeJobs: number
  workers: number
  existingAssignments: number
}

/**
 * The decision, as a pure function, so the rule can be read and tested without
 * a database. Every caller below asks this; none of them re-implement it.
 */
export function shouldAutoAssign(c: AutoAssignCounts): boolean {
  return c.activeJobs === 1 && c.workers === 1 && c.existingAssignments === 0
}

export type AutoAssignResult = { assigned: boolean; jobId?: string; userId?: string; why?: string }

/**
 * Best effort by design. This runs after a job or a worker has already been
 * created successfully, and a convenience must never turn that into an error
 * the caller sees -- the row they asked for exists either way.
 */
export async function maybeAutoAssignSoleWorker(service: any, companyId: string): Promise<AutoAssignResult> {
  try {
    const [jobsR, workersR, assignmentsR] = await Promise.all([
      service.from("jobs").select("id").eq("company_id", companyId).eq("status", "active").is("archived_at", null).limit(2),
      service.from("users").select("id, role, works_on_site").eq("company_id", companyId).eq("is_active", true).limit(50),
      service.from("job_assignments").select("id").eq("company_id", companyId).limit(1),
    ])

    const jobs = jobsR.data || []
    // Anyone who can be sent to a job: a field role, or an owner who has said
    // they work on site.
    const workers = (workersR.data || []).filter(
      (u: any) => FIELD_FOREMAN_SUBBIE.includes(String(u.role)) || u.works_on_site === true,
    )
    const counts: AutoAssignCounts = {
      activeJobs: jobs.length,
      workers: workers.length,
      existingAssignments: (assignmentsR.data || []).length,
    }
    if (!shouldAutoAssign(counts)) {
      return { assigned: false, why: `not the sole pairing (${counts.activeJobs} jobs, ${counts.workers} workers, ${counts.existingAssignments} assignments)` }
    }

    const jobId = jobs[0].id
    const userId = workers[0].id
    const { error } = await service.from("job_assignments").insert({ company_id: companyId, job_id: jobId, user_id: userId })
    if (error) {
      // A unique violation means somebody else linked them first, which is the
      // outcome this wanted anyway.
      if (error.code === "23505") return { assigned: false, why: "already assigned" }
      console.error("[auto-assign] insert failed:", error.message)
      return { assigned: false, why: error.message }
    }
    console.log(`[auto-assign] company=${companyId} linked the only worker to the only job`)
    return { assigned: true, jobId, userId }
  } catch (e: any) {
    console.error("[auto-assign] threw:", e?.message || e)
    return { assigned: false, why: "error" }
  }
}
