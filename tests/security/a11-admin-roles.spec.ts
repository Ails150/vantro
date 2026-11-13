// A11. Owner-only settings and a field session writing to the audit log.
//
// A foreman runs the site; the company's default pay rate, sick-day
// auto-approval, company details and subcontractor terms are the owner's. Each
// route let any dashboard role change them. /api/admin/audit POST let any
// signed-in user, field roles included, write entries into the audit log.
//
// Each refusal asserts the value is unchanged. The control test shows an admin
// still gets through, writing back the value that was already there so the
// shared [TEST] tenant is left as it was found.

import { test, expect } from "@playwright/test"
import {
  assertOnlyTestTenants, baseUrl, createProbe, destroyProbe, serviceClient,
  TENANT_A, type Probe,
} from "./harness"

assertOnlyTestTenants(TENANT_A.id)

let adminA: Probe | null = null
let foremanA: Probe | null = null
let fieldA: Probe | null = null
let subId = ""
const stamp = Date.now()

test.beforeAll(async () => {
  adminA = await createProbe(TENANT_A.id, "admin", "a11-admin")
  foremanA = await createProbe(TENANT_A.id, "foreman", "a11-foreman")
  fieldA = await createProbe(TENANT_A.id, "installer", "a11-field")
  const { data, error } = await serviceClient()
    .from("subcontractors")
    .insert({ company_id: TENANT_A.id, name: `[TEST] a11 sub ${stamp}`, rate_type: "daily", rate_amount: 100, active: true })
    .select("id")
    .single()
  if (error) throw new Error(`subcontractors: ${error.message}`)
  subId = (data as any).id
})

test.afterAll(async () => {
  if (subId) await serviceClient().from("subcontractors").delete().eq("id", subId).eq("company_id", TENANT_A.id)
  await destroyProbe(adminA)
  await destroyProbe(foremanA)
  await destroyProbe(fieldA)
})

function call(request: any, probe: Probe, method: "post" | "patch", path: string, data: any) {
  return request[method](`${baseUrl()}${path}`, {
    headers: { Cookie: probe.cookie, "Content-Type": "application/json" },
    data,
  })
}

async function company() {
  const { data } = await serviceClient()
    .from("companies")
    .select("name, default_hourly_rate, sick_auto_approve, grace_period_minutes")
    .eq("id", TENANT_A.id)
    .single()
  return data as any
}

test("a foreman cannot change owner settings, and a field session cannot write the audit log", async ({ request }) => {
  expect(foremanA, "probe foreman could not be created").not.toBeNull()
  expect(fieldA, "probe field user could not be created").not.toBeNull()
  const s = serviceClient()
  const before = await company()
  const rate = before.default_hourly_rate == null ? null : Number(before.default_hourly_rate)
  const otherRate = rate === 12.34 ? 12.35 : 12.34

  let res = await call(request, foremanA!, "post", "/api/admin/settings", { default_hourly_rate: otherRate })
  expect(res.status(), `settings rate: ${await res.text()}`).toBe(403)
  res = await call(request, foremanA!, "post", "/api/admin/settings", { sick_auto_approve: !before.sick_auto_approve })
  expect(res.status(), `settings sick: ${await res.text()}`).toBe(403)

  res = await call(request, foremanA!, "patch", "/api/admin/company", { name: `[TEST] a11 renamed ${stamp}` })
  expect(res.status(), `company: ${await res.text()}`).toBe(403)

  res = await call(request, foremanA!, "patch", `/api/admin/subcontractors/${subId}`, { rate_amount: 999 })
  expect(res.status(), `subcontractor: ${await res.text()}`).toBe(403)

  const action = `[TEST] a11 forged ${stamp}`
  res = await call(request, fieldA!, "post", "/api/admin/audit", { action, entity_type: "test", entity_id: null })
  expect(res.status(), `audit: ${await res.text()}`).toBe(403)

  const after = await company()
  expect(after.name, "company was renamed").toBe(before.name)
  expect(after.default_hourly_rate == null ? null : Number(after.default_hourly_rate), "default rate changed").toBe(rate)
  expect(!!after.sick_auto_approve, "sick auto-approve changed").toBe(!!before.sick_auto_approve)
  const { data: sub } = await s.from("subcontractors").select("rate_amount, active").eq("id", subId).single()
  expect(Number((sub as any).rate_amount), "subcontractor rate changed").toBe(100)
  const { count: forged } = await s.from("audit_log").select("id", { count: "exact", head: true }).eq("company_id", TENANT_A.id).eq("action", action)
  expect(forged, "a field session wrote to the audit log").toBe(0)
})

// The controls. A foreman saving the settings page unchanged must still work,
// because the page sends every field; and an admin must get through each gate.
test("a foreman keeps the rest of settings, and an admin passes every gate", async ({ request }) => {
  expect(adminA, "probe admin could not be created").not.toBeNull()
  expect(foremanA, "probe foreman could not be created").not.toBeNull()
  const s = serviceClient()
  const before = await company()

  let res = await call(request, foremanA!, "post", "/api/admin/settings", {
    grace_period_minutes: before.grace_period_minutes,
    default_hourly_rate: before.default_hourly_rate,
    sick_auto_approve: !!before.sick_auto_approve,
  })
  expect(res.status(), `foreman unchanged save: ${await res.text()}`).toBe(200)

  // Written back as found; an unset sick flag is left unset rather than made false.
  res = await call(request, adminA!, "post", "/api/admin/settings", {
    default_hourly_rate: before.default_hourly_rate,
    ...(before.sick_auto_approve == null ? {} : { sick_auto_approve: before.sick_auto_approve }),
  })
  expect(res.status(), `admin settings: ${await res.text()}`).toBe(200)

  res = await call(request, adminA!, "patch", "/api/admin/company", { name: before.name })
  expect(res.status(), `admin company: ${await res.text()}`).toBe(200)

  res = await call(request, adminA!, "patch", `/api/admin/subcontractors/${subId}`, { notes: "[TEST] a11 admin edit" })
  expect(res.status(), `admin subcontractor: ${await res.text()}`).toBe(200)

  // Past the role gate and stopped by validation, so nothing is written to a
  // log that may not be deletable.
  res = await call(request, adminA!, "post", "/api/admin/audit", { action: `[TEST] a11 ${stamp}`, entity_type: "test", entity_id: "not-a-uuid" })
  expect(res.status(), `admin audit: ${await res.text()}`).toBe(400)

  const after = await company()
  expect(after.name).toBe(before.name)
  expect(after.default_hourly_rate == null ? null : Number(after.default_hourly_rate))
    .toBe(before.default_hourly_rate == null ? null : Number(before.default_hourly_rate))
  expect(!!after.sick_auto_approve).toBe(!!before.sick_auto_approve)
  const { data: sub } = await s.from("subcontractors").select("notes").eq("id", subId).single()
  expect((sub as any).notes).toBe("[TEST] a11 admin edit")
})
