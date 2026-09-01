import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"

/**
 * Tenant ownership guards.
 *
 * Almost every route takes an id from the request body and then reaches a row
 * with it. The id is attacker controlled; the caller's company is not. Without
 * a comparison between the two, a valid token for company A authorises work on
 * company B's data. That defect appeared independently in /api/signin,
 * /api/signout, /api/qa, /api/qa/submit and /api/client/invite, which is what a
 * per-route convention gets you.
 *
 * Everything here answers 404, never 403, and with the same body as a genuinely
 * missing row. A 403 tells the caller the id exists, which turns the endpoint
 * into an oracle for enumerating other tenants' ids.
 */

export type OwnershipResult<T> =
  | { ok: true; job: T }
  | { ok: false; response: NextResponse }

function notFound(): NextResponse {
  return NextResponse.json({ error: "Job not found" }, { status: 404 })
}

/**
 * Resolve a job id supplied by the caller, but only if it belongs to their
 * company. Returns the row so the caller does not fetch it twice.
 *
 * `columns` must include company_id; it is added if missing.
 */
export async function assertJobBelongsToCaller<T = any>(
  jobId: unknown,
  companyId: string | null | undefined,
  columns = "id, company_id",
): Promise<OwnershipResult<T>> {
  if (typeof jobId !== "string" || !jobId || !companyId) {
    return { ok: false, response: notFound() }
  }

  const select = columns.includes("company_id") ? columns : `${columns}, company_id`

  const service = await createServiceClient()
  const { data: job } = await service
    .from("jobs")
    .select(select)
    .eq("id", jobId)
    .single()

  // Missing and foreign are deliberately indistinguishable.
  if (!job || (job as any).company_id !== companyId) {
    return { ok: false, response: notFound() }
  }

  return { ok: true, job: job as T }
}
