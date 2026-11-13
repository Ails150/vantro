// A9. /api/checklist against another company's templates, items and jobs.
//
// Before the fix, any signed-in user of any company could post another
// company's ids to every action: delete their checklist items (and the QA
// submissions recorded against them), rewrite or delete their templates, add
// items to their templates, and change which checklists their jobs use.
//
// Every attack asserts on what is left in tenant B afterwards, not just the
// status code. The last test is the control: the same admin can still do all
// of it to their own company's records.

import { test, expect } from "@playwright/test"
import {
  assertOnlyTestTenants, baseUrl, createProbe, destroyProbe, serviceClient,
  TENANT_A, TENANT_B, type Probe,
} from "./harness"

assertOnlyTestTenants(TENANT_A.id, TENANT_B.id)

let adminA: Probe | null = null
const made: Array<{ table: string; id: string; company: string }> = []
let bTemplate = "", bItem = "", bJob = ""
const bName = `[TEST] a9 template ${Date.now()}`

async function mk(table: string, row: Record<string, any>) {
  const { data, error } = await serviceClient().from(table).insert(row).select("id").single()
  if (error) throw new Error(`${table}: ${error.message}`)
  made.push({ table, id: (data as any).id, company: row.company_id })
  return (data as any).id as string
}

test.beforeAll(async () => {
  adminA = await createProbe(TENANT_A.id, "admin", "a9-admin-a")
  bTemplate = await mk("checklist_templates", { company_id: TENANT_B.id, name: bName, frequency: "job" })
  bItem = await mk("checklist_items", { company_id: TENANT_B.id, template_id: bTemplate, label: "[TEST] a9 item", item_type: "tick", sort_order: 0 })
  bJob = await mk("jobs", { company_id: TENANT_B.id, name: `[TEST] a9 job ${Date.now()}`, address: "", status: "active", required_trades: [] })
  const { error } = await serviceClient().from("job_checklists").insert({ job_id: bJob, template_id: bTemplate })
  if (error) throw new Error(`job_checklists: ${error.message}`)
})

test.afterAll(async () => {
  const s = serviceClient()
  if (bJob) await s.from("job_checklists").delete().eq("job_id", bJob)
  for (const m of made.reverse()) await s.from(m.table).delete().eq("id", m.id).eq("company_id", m.company)
  await destroyProbe(adminA)
})

async function post(request: any, body: Record<string, any>) {
  return request.post(`${baseUrl()}/api/checklist`, {
    headers: { Cookie: adminA!.cookie, "Content-Type": "application/json" },
    data: body,
  })
}

test("a company A admin cannot touch company B's checklists", async ({ request }) => {
  expect(adminA, "probe admin for tenant A could not be created").not.toBeNull()
  const s = serviceClient()

  const attacks = [
    { action: "delete_item", itemId: bItem },
    { action: "update_template", templateId: bTemplate, name: "pwned", requires_approval: true, audit_only: true },
    { action: "add_item", templateId: bTemplate, label: "[TEST] a9 injected", item_type: "tick" },
    { action: "remove_from_job", jobId: bJob, templateId: "all" },
    { action: "remove_from_job", jobId: bJob, templateId: bTemplate },
    { action: "assign_to_job", jobId: bJob, templateId: bTemplate },
    { action: "delete_template", templateId: bTemplate },
  ]
  for (const a of attacks) {
    const res = await post(request, a)
    expect(res.status(), `${a.action}: ${await res.text()}`).toBe(404)
  }

  const { data: tpl } = await s.from("checklist_templates").select("name, requires_approval").eq("id", bTemplate).maybeSingle()
  expect(tpl, "tenant B template was deleted").not.toBeNull()
  expect((tpl as any).name, "tenant B template was renamed").toBe(bName)
  const { data: item } = await s.from("checklist_items").select("id").eq("id", bItem).maybeSingle()
  expect(item, "tenant B item was deleted").not.toBeNull()
  const { count: items } = await s.from("checklist_items").select("id", { count: "exact", head: true }).eq("template_id", bTemplate)
  expect(items, "an item was injected into tenant B's template").toBe(1)
  const { count: links } = await s.from("job_checklists").select("id", { count: "exact", head: true }).eq("job_id", bJob)
  expect(links, "tenant B's job checklist link was removed").toBe(1)

  const list = await request.get(`${baseUrl()}/api/checklist`, { headers: { Cookie: adminA!.cookie } })
  expect(list.status()).toBe(200)
  expect(await list.text()).not.toContain(bTemplate)
})

// The control. Without it, a route that refused everything would pass above.
test("the same admin can still manage their own company's checklists", async ({ request }) => {
  expect(adminA, "probe admin for tenant A could not be created").not.toBeNull()
  const s = serviceClient()
  const aJob = await mk("jobs", { company_id: TENANT_A.id, name: `[TEST] a9 own job ${Date.now()}`, address: "", status: "active", required_trades: [] })

  const created = await post(request, { action: "create_template", name: `[TEST] a9 own ${Date.now()}` })
  expect(created.status(), await created.text()).toBe(200)
  const tId = (await created.json()).template.id
  made.push({ table: "checklist_templates", id: tId, company: TENANT_A.id })

  const added = await post(request, { action: "add_item", templateId: tId, label: "[TEST] a9 own item", item_type: "tick" })
  expect(added.status(), await added.text()).toBe(200)
  const iId = (await added.json()).item.id

  for (const a of [
    { action: "update_template", templateId: tId, name: "[TEST] a9 renamed", requires_approval: false, audit_only: false },
    { action: "assign_to_job", jobId: aJob, templateId: tId },
    { action: "remove_from_job", jobId: aJob, templateId: tId },
    { action: "delete_item", itemId: iId },
    { action: "delete_template", templateId: tId },
  ]) {
    const res = await post(request, a)
    expect(res.status(), `${a.action}: ${await res.text()}`).toBe(200)
  }
  const { data: gone } = await s.from("checklist_templates").select("id").eq("id", tId).maybeSingle()
  expect(gone).toBeNull()
})
