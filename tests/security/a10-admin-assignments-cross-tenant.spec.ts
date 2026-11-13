// A10. Admin assignment, job and RAMS routes against another company's ids.
//
// These routes run on the service role. Before the fix each took a job, user or
// template id from the request and used it without asking whose it was, so a
// company A admin could put A's installers on B's jobs (and B's installers on
// A's), schedule visits on B's jobs, create a job carrying B's checklist, and
// read B's crew list through the RAMS view.
//
// Every attack asserts on tenant B's rows afterwards, not just the status. The
// second test is the control: the same admin can still do each operation to
// their own company's rows.

import { test, expect } from "@playwright/test"
import {
  assertOnlyTestTenants, baseUrl, createProbe, destroyProbe, serviceClient,
  TENANT_A, TENANT_B, type Probe,
} from "./harness"

assertOnlyTestTenants(TENANT_A.id, TENANT_B.id)

let adminA: Probe | null = null
let workerA: Probe | null = null
let workerB: Probe | null = null
const made: Array<{ table: string; id: string; company: string }> = []
const jobsToClear: string[] = []
let aJob = "", bJob = "", aTemplate = "", bTemplate = "", aVisit = "", aAssignment = ""
const stamp = Date.now()
const DATE = "2031-03-04"

async function mk(table: string, row: Record<string, any>) {
  const { data, error } = await serviceClient().from(table).insert(row).select("id").single()
  if (error) throw new Error(`${table}: ${error.message}`)
  made.push({ table, id: (data as any).id, company: row.company_id })
  return (data as any).id as string
}

async function mkJob(company: string, label: string) {
  const id = await mk("jobs", { company_id: company, name: `[TEST] a10 ${label} ${stamp}`, address: "", status: "active", required_trades: [] })
  jobsToClear.push(id)
  return id
}

test.beforeAll(async () => {
  adminA = await createProbe(TENANT_A.id, "admin", "a10-admin-a")
  workerA = await createProbe(TENANT_A.id, "installer", "a10-worker-a")
  workerB = await createProbe(TENANT_B.id, "installer", "a10-worker-b")
  aJob = await mkJob(TENANT_A.id, "own job")
  bJob = await mkJob(TENANT_B.id, "victim job")
  aTemplate = await mk("checklist_templates", { company_id: TENANT_A.id, name: `[TEST] a10 own template ${stamp}`, frequency: "job" })
  bTemplate = await mk("checklist_templates", { company_id: TENANT_B.id, name: `[TEST] a10 victim template ${stamp}`, frequency: "job" })
  aVisit = await mk("job_visits", { company_id: TENANT_A.id, job_id: aJob, start_at: `${DATE}T00:00:00`, end_at: `${DATE}T23:59:59`, status: "scheduled" })
  if (workerA) {
    aAssignment = await mk("visit_assignments", { company_id: TENANT_A.id, visit_id: aVisit, user_id: workerA.userId, role: "operative" })
  }
})

test.afterAll(async () => {
  const s = serviceClient()
  // Jobs created through the route under test are found by name.
  const { data: viaRoute } = await s.from("jobs").select("id").eq("company_id", TENANT_A.id).like("name", `[TEST] a10 % ${stamp}`)
  for (const j of viaRoute || []) if (!jobsToClear.includes((j as any).id)) jobsToClear.push((j as any).id)

  if (jobsToClear.length) {
    const { data: visits } = await s.from("job_visits").select("id").in("job_id", jobsToClear)
    const visitIds = (visits || []).map((v: any) => v.id)
    if (visitIds.length) await s.from("visit_assignments").delete().in("visit_id", visitIds)
    await s.from("job_visits").delete().in("job_id", jobsToClear)
    await s.from("job_assignments").delete().in("job_id", jobsToClear)
    await s.from("job_checklists").delete().in("job_id", jobsToClear)
  }
  for (const p of [workerA, workerB]) {
    if (p) {
      await s.from("visit_assignments").delete().eq("user_id", p.userId)
      await s.from("job_assignments").delete().eq("user_id", p.userId)
    }
  }
  // Jobs before templates: a job created by the route points at aTemplate.
  for (const id of jobsToClear) await s.from("jobs").delete().eq("id", id).in("company_id", [TENANT_A.id, TENANT_B.id])
  for (const m of made.reverse()) await s.from(m.table).delete().eq("id", m.id).eq("company_id", m.company)
  await destroyProbe(adminA)
  await destroyProbe(workerA)
  await destroyProbe(workerB)
})

function call(request: any, method: "get" | "post" | "patch", path: string, data?: any) {
  return request[method](`${baseUrl()}${path}`, {
    headers: { Cookie: adminA!.cookie, "Content-Type": "application/json" },
    ...(data !== undefined ? { data } : {}),
  })
}

async function count(table: string, col: string, value: string) {
  const { count: n } = await serviceClient().from(table).select("id", { count: "exact", head: true }).eq(col, value)
  return n || 0
}

test("a company A admin cannot attach, schedule or read against company B's rows", async ({ request }) => {
  expect(adminA, "probe admin for tenant A could not be created").not.toBeNull()
  expect(workerA, "probe worker for tenant A could not be created").not.toBeNull()
  expect(workerB, "probe worker for tenant B could not be created").not.toBeNull()
  const s = serviceClient()
  const jobName = `[TEST] a10 injected job ${stamp}`

  const attacks: Array<[string, "get" | "post" | "patch", string, any]> = [
    ["matrix: B job", "post", "/api/admin/assignments-matrix", { add: [{ job_id: bJob, user_id: workerA!.userId }] }],
    ["matrix: B user", "post", "/api/admin/assignments-matrix", { add: [{ job_id: aJob, user_id: workerB!.userId }] }],
    ["assign-all: B job", "post", "/api/admin/assign-all", { jobId: bJob }],
    ["visit: B job", "post", "/api/admin/visit-assignments", { job_id: bJob, user_id: workerA!.userId, date: DATE }],
    ["visit: B user", "post", "/api/admin/visit-assignments", { job_id: aJob, user_id: workerB!.userId, date: DATE }],
    ["visit move: B user", "patch", `/api/admin/visit-assignments/${aAssignment}`, { user_id: workerB!.userId }],
    ["visit move+date: B user", "patch", `/api/admin/visit-assignments/${aAssignment}`, { user_id: workerB!.userId, target_date: "2031-03-05" }],
    ["jobs: B template", "post", "/api/admin/jobs", { name: jobName, checklist_template_id: bTemplate }],
    ["rams: B job", "get", `/api/admin/rams?jobId=${bJob}`, undefined],
  ]
  for (const [label, method, path, body] of attacks) {
    const res = await call(request, method, path, body)
    expect(res.status(), `${label}: ${await res.text()}`).toBe(404)
  }

  expect(await count("job_assignments", "job_id", bJob), "someone was assigned to tenant B's job").toBe(0)
  expect(await count("job_assignments", "user_id", workerB!.userId), "tenant B's worker was assigned").toBe(0)
  expect(await count("job_visits", "job_id", bJob), "a visit was scheduled on tenant B's job").toBe(0)
  expect(await count("visit_assignments", "user_id", workerB!.userId), "tenant B's worker was put on a visit").toBe(0)
  // Refused before any lookup or insert: no visit was created on A's job either.
  expect(await count("job_visits", "job_id", aJob), "a visit was created before the check").toBe(1)
  const { data: va } = await s.from("visit_assignments").select("user_id, visit_id").eq("id", aAssignment).single()
  expect((va as any).user_id, "the assignment was moved to tenant B's worker").toBe(workerA!.userId)
  expect((va as any).visit_id, "the assignment was moved").toBe(aVisit)
  expect(await count("jobs", "name", jobName), "a job was created carrying tenant B's checklist").toBe(0)
})

// The control. Without it, a route that refused everything would pass above.
test("the same admin can still do each operation on their own company's rows", async ({ request }) => {
  expect(adminA, "probe admin for tenant A could not be created").not.toBeNull()
  expect(workerA, "probe worker for tenant A could not be created").not.toBeNull()
  const s = serviceClient()
  const pair = { job_id: aJob, user_id: workerA!.userId }

  let res = await call(request, "post", "/api/admin/assignments-matrix", { add: [pair] })
  expect(res.status(), `matrix add: ${await res.text()}`).toBe(200)
  expect((await res.json()).added).toBe(1)
  res = await call(request, "post", "/api/admin/assignments-matrix", { remove: [pair] })
  expect(res.status(), `matrix remove: ${await res.text()}`).toBe(200)
  const { count: left } = await s.from("job_assignments").select("id", { count: "exact", head: true }).eq("job_id", aJob).eq("user_id", workerA!.userId)
  expect(left).toBe(0)

  res = await call(request, "post", "/api/admin/assign-all", { jobId: aJob })
  expect(res.status(), `assign-all: ${await res.text()}`).toBe(200)
  const { count: onJob } = await s.from("job_assignments").select("id", { count: "exact", head: true }).eq("job_id", aJob).eq("user_id", workerA!.userId)
  expect(onJob, "assign-all did not assign tenant A's worker").toBe(1)

  res = await call(request, "post", "/api/admin/visit-assignments", { job_id: aJob, user_id: workerA!.userId, date: "2031-03-06" })
  expect(res.status(), `visit: ${await res.text()}`).toBe(200)

  res = await call(request, "patch", `/api/admin/visit-assignments/${aAssignment}`, { user_id: workerA!.userId })
  expect(res.status(), `visit move: ${await res.text()}`).toBe(200)
  res = await call(request, "patch", `/api/admin/visit-assignments/${aAssignment}`, { user_id: workerA!.userId, target_date: "2031-03-05" })
  expect(res.status(), `visit move+date: ${await res.text()}`).toBe(200)

  res = await call(request, "post", "/api/admin/jobs", { name: `[TEST] a10 created job ${stamp}`, checklist_template_id: aTemplate })
  expect(res.status(), `jobs: ${await res.text()}`).toBe(200)
  const newJob = (await res.json()).id
  jobsToClear.push(newJob)
  const { data: created } = await s.from("jobs").select("checklist_template_id").eq("id", newJob).single()
  expect((created as any).checklist_template_id).toBe(aTemplate)

  res = await call(request, "get", `/api/admin/rams?jobId=${aJob}`)
  expect(res.status(), `rams: ${await res.text()}`).toBe(200)
})
