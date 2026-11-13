// lib/job-ownership.ts
//
// Does this job belong to this company? Asked BEFORE a route touches anything.
//
// THE BUG THIS EXISTS FOR. /api/jobs/delete took a jobId from the request body
// and, using the service role, deleted every signin, diary entry, QA
// submission, QA approval, defect, alert and assignment with that job_id. Only
// the final delete of the jobs row itself was scoped to the caller's company.
// So an admin of any company could post another company's job id and wipe its
// shifts and evidence; the job row survived, so nothing looked wrong.
//
// Scoping the last statement is not enough when the statements before it do
// the damage. The check has to come first and gate everything after it.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value)
}

/**
 * The job's id if it exists AND belongs to companyId, otherwise null.
 *
 * Another company's job and a job that does not exist give the same answer, so
 * a caller cannot use this to learn which ids exist in other tenants.
 */
export async function ownedJobId(
  service: any,
  jobId: unknown,
  companyId: string | null | undefined,
): Promise<string | null> {
  if (!isUuid(jobId) || !companyId) return null
  const { data, error } = await service
    .from("jobs")
    .select("id, company_id")
    .eq("id", jobId)
    .eq("company_id", companyId)
    .maybeSingle()
  if (error || !data) return null
  // Belt and braces: a query builder that ignored a filter must not pass.
  if (data.id !== jobId || data.company_id !== companyId) return null
  return data.id
}
