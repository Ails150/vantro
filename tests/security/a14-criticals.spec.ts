// A14. The critical and account-level gaps from the November 2026 route sweep.
//
//   team/remove   an admin deleted ANY auth account via a body authUserId
//   defects       resolve/reopen rewrote any company's defect; create took any
//                 job id and any storage path
//   qa/approvals  any signed-in user approved any company's QA
//   billing       the plan was granted before payment
//   join          the shared link returned a field token for any member, and
//                 switched deactivated workers back on
//   onboarding    any session user could add admins or support users
//
// Every attack asserts on what is left afterwards, not just the status code,
// and each area has a control showing the legitimate path still works.

import { test, expect } from "@playwright/test"
import {
  assertOnlyTestTenants, baseUrl, createProbe, destroyProbe, serviceClient,
  TENANT_A, TENANT_B, type Probe,
} from "./harness"

assertOnlyTestTenants(TENANT_A.id, TENANT_B.id)

const probes: Probe[] = []
const made: Array<{ table: string; id: string; company: string }> = []
const stamp = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`

async function probe(company: string, role: string, label: string) {
  const p = await createProbe(company, role, label)
  expect(p, `could not create ${role} probe ${label}`).not.toBeNull()
  probes.push(p!)
  return p!
}
async function mk(table: string, row: Record<string, any>) {
  const { data, error } = await serviceClient().from(table).insert(row).select("*").single()
  if (error) throw new Error(`${table}: ${error.message}`)
  made.push({ table, id: (data as any).id, company: row.company_id })
  return data as any
}
const job = (company: string) =>
  mk("jobs", { company_id: company, name: `[TEST] a14 job ${stamp()}`, address: "", status: "active", required_trades: [] })

function post(request: any, path: string, p: Probe | null, data: any) {
  return request.post(`${baseUrl()}${path}`, {
    headers: { ...(p ? { Cookie: p.cookie } : {}), "Content-Type": "application/json" },
    data,
  })
}

test.afterAll(async () => {
  const s = serviceClient()
  for (const m of made.reverse()) await s.from(m.table).delete().eq("id", m.id).eq("company_id", m.company)
  for (const p of probes) await destroyProbe(p)
})

test.describe.configure({ mode: "serial" })

test("team/remove: an admin cannot delete another company's login", async ({ request }) => {
  const s = serviceClient()
  const adminA = await probe(TENANT_A.id, "admin", "a14-remove-admin")
  const victimB = await probe(TENANT_B.id, "admin", "a14-remove-victim")
  const workerA = await probe(TENANT_A.id, "installer", "a14-remove-worker")

  // The old attack: a legitimate own-company userId, plus someone else's authUserId.
  const res = await post(request, "/api/team/remove", adminA, { userId: workerA.userId, authUserId: victimB.authUserId })
  expect(res.status(), await res.text()).toBe(200)

  const { data: victim } = await s.auth.admin.getUserById(victimB.authUserId)
  expect(victim?.user, "tenant B's login was deleted by tenant A's admin").toBeTruthy()

  // Control: the worker that WAS named is gone, login and all.
  const { data: worker } = await s.auth.admin.getUserById(workerA.authUserId)
  expect(worker?.user ?? null).toBeNull()
  const { data: row } = await s.from("users").select("id").eq("id", workerA.userId).maybeSingle()
  expect(row).toBeNull()
})

test("defects: no cross-company resolve, reopen or create; foreign paths dropped", async ({ request }) => {
  const s = serviceClient()
  const adminA = await probe(TENANT_A.id, "admin", "a14-defects-admin")
  const jobB = await job(TENANT_B.id)
  const defB = await mk("defects", { company_id: TENANT_B.id, job_id: jobB.id, description: "[TEST] a14 B defect", severity: "minor", status: "open" })

  for (const action of ["resolve", "reopen"]) {
    const r = await post(request, "/api/defects", adminA, { action, defectId: defB.id, resolutionNote: "pwned" })
    expect(r.status(), `${action}: ${await r.text()}`).toBe(404)
  }
  const { data: after } = await s.from("defects").select("status, resolution_note, resolved_by").eq("id", defB.id).single()
  expect(after).toEqual({ status: "open", resolution_note: null, resolved_by: null })

  const create = await post(request, "/api/defects", adminA, { action: "create", jobId: jobB.id, description: "[TEST] a14 injected", severity: "minor" })
  expect(create.status(), await create.text()).toBe(404)
  const { count } = await s.from("defects").select("id", { count: "exact", head: true }).eq("job_id", jobB.id)
  expect(count, "a defect was attached to tenant B's job").toBe(1)

  // Control: own job works, and a path outside the company is not stored.
  const jobA = await job(TENANT_A.id)
  const own = await post(request, "/api/defects", adminA, {
    action: "create", jobId: jobA.id, description: "[TEST] a14 own", severity: "minor",
    photoPath: `u/${TENANT_B.id}/202611/defect/7c1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f.jpg`, videoPath: `u/${TENANT_A.id}/202611/defect/0b6f7d1e-2c3a-4f5b-9a8c-1d2e3f4a5b6c.mp4`,
  })
  expect(own.status(), await own.text()).toBe(200)
  const d = (await own.json()).defect
  made.push({ table: "defects", id: d.id, company: TENANT_A.id })
  expect(d.photo_path).toBeNull()
  expect(d.video_path).toBe(`u/${TENANT_A.id}/202611/defect/0b6f7d1e-2c3a-4f5b-9a8c-1d2e3f4a5b6c.mp4`)
  const resolved = await post(request, "/api/defects", adminA, { action: "resolve", defectId: d.id, resolutionNote: "fixed" })
  expect(resolved.status(), await resolved.text()).toBe(200)
})

test("qa/approvals: other companies' approvals and field sessions are refused", async ({ request }) => {
  const s = serviceClient()
  const adminA = await probe(TENANT_A.id, "admin", "a14-qa-admin")
  const fieldA = await probe(TENANT_A.id, "installer", "a14-qa-field")
  const workerB = await probe(TENANT_B.id, "installer", "a14-qa-worker-b")
  const jobB = await job(TENANT_B.id)
  const apprB = await mk("qa_approvals", { company_id: TENANT_B.id, job_id: jobB.id, user_id: workerB.userId, status: "pending", submitted_at: new Date().toISOString() })

  const r = await post(request, "/api/qa/approvals", adminA, { approvalId: apprB.id, action: "approved" })
  expect(r.status(), await r.text()).toBe(404)
  const { data: after } = await s.from("qa_approvals").select("status, reviewed_by").eq("id", apprB.id).single()
  expect(after).toEqual({ status: "pending", reviewed_by: null })

  const jobA = await job(TENANT_A.id)
  const apprA = await mk("qa_approvals", { company_id: TENANT_A.id, job_id: jobA.id, user_id: fieldA.userId, status: "pending", submitted_at: new Date().toISOString() })
  const asField = await post(request, "/api/qa/approvals", fieldA, { approvalId: apprA.id, action: "approved" })
  expect(asField.status(), "a field session approved QA").toBe(403)

  // Control.
  const ok = await post(request, "/api/qa/approvals", adminA, { approvalId: apprA.id, action: "approved" })
  expect(ok.status(), await ok.text()).toBe(200)
  const { data: done } = await s.from("qa_approvals").select("status").eq("id", apprA.id).single()
  expect((done as any).status).toBe("approved")
})

test("billing/upgrade: no plan before payment, and owners only", async ({ request }) => {
  const s = serviceClient()
  const { data: before } = await s.from("companies").select("plan, stripe_subscription_id").eq("id", TENANT_A.id).single()
  // Never run the admin call against a company with a live subscription: that
  // branch changes a real Stripe price.
  expect((before as any).stripe_subscription_id, "tenant A has a Stripe subscription; refusing to test billing").toBeNull()

  const foreman = await probe(TENANT_A.id, "foreman", "a14-billing-foreman")
  const target = (before as any).plan === "payroll" ? "suite" : "payroll"
  const f = await post(request, "/api/billing/upgrade", foreman, { newPlan: target })
  expect(f.status(), await f.text()).toBe(403)

  const admin = await probe(TENANT_A.id, "admin", "a14-billing-admin")
  const a = await post(request, "/api/billing/upgrade", admin, { newPlan: target })
  expect([200, 503], await a.text()).toContain(a.status())
  const { data: after } = await s.from("companies").select("plan").eq("id", TENANT_A.id).single()
  expect((after as any).plan, "the plan changed before payment").toBe((before as any).plan)
})

test("join: no token for office accounts, no reactivation; new workers still join", async ({ request }) => {
  const s = serviceClient()
  const adminA = await probe(TENANT_A.id, "admin", "a14-join-admin")
  const link = await request.get(`${baseUrl()}/api/admin/invite-link`, { headers: { Cookie: adminA.cookie } })
  expect(link.status(), await link.text()).toBe(200)
  const token = String((await link.json()).url).split("/join/")[1]

  const asAdmin = await post(request, "/api/join", null, { token, name: "Anyone", email: adminA.email })
  expect(asAdmin.status(), "the join link handed out a token for an admin").toBe(409)
  expect(JSON.stringify(await asAdmin.json())).not.toContain("token\":\"ey")

  const sacked = await probe(TENANT_A.id, "installer", "a14-join-sacked")
  await s.from("users").update({ is_active: false }).eq("id", sacked.userId)
  const back = await post(request, "/api/join", null, { token, name: "Sacked Worker", email: sacked.email })
  expect(back.status()).toBe(409)
  const { data: still } = await s.from("users").select("is_active").eq("id", sacked.userId).single()
  expect((still as any).is_active, "a deactivated worker was switched back on").toBe(false)

  // Control: a new worker joins.
  const email = `security-a14-join-${stamp()}@vantro.test`
  const fresh = await post(request, "/api/join", null, { token, name: "[TEST] a14 New Worker", email })
  expect(fresh.status(), await fresh.text()).toBe(200)
  expect((await fresh.json()).token).toBeTruthy()
  await s.from("users").delete().eq("email", email).eq("company_id", TENANT_A.id)
})

test("onboarding: owners only, and never an admin or support role", async ({ request }) => {
  const s = serviceClient()
  const foreman = await probe(TENANT_A.id, "foreman", "a14-onb-foreman")
  const emails = [`security-a14-onb-a-${stamp()}@vantro.test`, `security-a14-onb-b-${stamp()}@vantro.test`]

  const f = await post(request, "/api/onboarding", foreman, { step: "installers", installers: [{ name: "[TEST] a14 x", email: emails[0], role: "admin" }] })
  expect(f.status(), await f.text()).toBe(403)
  const fj = await post(request, "/api/onboarding", foreman, { step: "jobs", jobs: [{ name: "[TEST] a14 j", address: "x" }] })
  expect(fj.status(), await fj.text()).toBe(403)

  // Control: an admin adds people, and asked-for admin/support become field.
  const admin = await probe(TENANT_A.id, "admin", "a14-onb-admin")
  const ok = await post(request, "/api/onboarding", admin, {
    step: "installers",
    installers: [{ name: "[TEST] a14 sup", email: emails[0], role: "support" }, { name: "[TEST] a14 adm", email: emails[1], role: "admin" }],
  })
  expect(ok.status(), await ok.text()).toBe(200)
  const { data: rows } = await s.from("users").select("email, role").in("email", emails)
  try {
    expect((rows || []).length).toBe(2)
    for (const r of rows || []) expect((r as any).role, `${(r as any).email} got ${(r as any).role}`).toBe("field")
  } finally {
    await s.from("users").delete().in("email", emails).eq("company_id", TENANT_A.id)
  }
})
