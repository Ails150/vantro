// A8. A company A admin posts a company B job id to /api/jobs/delete.
//
// Before the fix, the route deleted every signin, diary entry, QA row, defect,
// alert and assignment on that job id with the service role, and only the last
// statement (the jobs row) was scoped to the caller's company. So the attack
// "failed" in the sense that the job survived, while its records were gone.
//
// The assertion is therefore on the CHILD rows, not the job: a witness alert on
// the tenant B job must still exist afterwards. The status must be a refusal.

import { test, expect } from "@playwright/test"
import {
  assertOnlyTestTenants, baseUrl, createProbe, destroyProbe, serviceClient,
  TENANT_A, TENANT_B, type Probe,
} from "./harness"

assertOnlyTestTenants(TENANT_A.id, TENANT_B.id)

let adminA: Probe | null = null
let jobB = ""
let witnessAlertId = ""

test.beforeAll(async () => {
  adminA = await createProbe(TENANT_A.id, "admin", "a8-admin-a")
  const service = serviceClient()
  const { data: job } = await service
    .from("jobs")
    .insert({ company_id: TENANT_B.id, name: `[TEST] a8 target ${Date.now()}`, address: "", status: "active", required_trades: [] })
    .select("id").single()
  jobB = (job as any)?.id || ""
  const { data: alert } = await service
    .from("alerts")
    .insert({ company_id: TENANT_B.id, job_id: jobB, message: "[TEST] a8 witness", alert_type: "issue", status: "open", is_read: false })
    .select("id").single()
  witnessAlertId = (alert as any)?.id || ""
})

test.afterAll(async () => {
  const service = serviceClient()
  if (witnessAlertId) await service.from("alerts").delete().eq("id", witnessAlertId)
  if (jobB) await service.from("jobs").delete().eq("id", jobB).eq("company_id", TENANT_B.id)
  await destroyProbe(adminA)
})

test("a company A admin cannot delete a company B job's records", async ({ request }) => {
  expect(adminA, "probe admin for tenant A could not be created").not.toBeNull()
  expect(jobB, "tenant B target job could not be created").not.toBe("")
  expect(witnessAlertId, "tenant B witness alert could not be created").not.toBe("")

  const res = await request.post(`${baseUrl()}/api/jobs/delete`, {
    headers: { Cookie: adminA!.cookie, "Content-Type": "application/json" },
    data: { jobId: jobB },
  })
  expect(res.status(), await res.text()).toBe(404)

  const service = serviceClient()
  const { data: alert } = await service.from("alerts").select("id").eq("id", witnessAlertId).maybeSingle()
  expect(alert, "tenant B's alert was deleted by tenant A").not.toBeNull()
  const { data: job } = await service.from("jobs").select("id").eq("id", jobB).maybeSingle()
  expect(job).not.toBeNull()
})

// The control. Without it, a route that refused everything would pass above.
test("the same admin can still delete their own company's job", async ({ request }) => {
  expect(adminA, "probe admin for tenant A could not be created").not.toBeNull()
  const service = serviceClient()
  const { data: own } = await service
    .from("jobs")
    .insert({ company_id: TENANT_A.id, name: `[TEST] a8 own ${Date.now()}`, address: "", status: "active", required_trades: [] })
    .select("id").single()
  const ownId = (own as any)?.id
  expect(ownId, "tenant A job could not be created").toBeTruthy()

  const res = await request.post(`${baseUrl()}/api/jobs/delete`, {
    headers: { Cookie: adminA!.cookie, "Content-Type": "application/json" },
    data: { jobId: ownId },
  })
  expect(res.status(), await res.text()).toBe(200)
  const { data: gone } = await service.from("jobs").select("id").eq("id", ownId).maybeSingle()
  expect(gone).toBeNull()
})
