// A13. Dashboard and owner routes that only asked "is there a session".
//
// A field worker can hold a Supabase session (the invite and magic-link paths
// hand one out), and each of these routes used to accept any session at all:
// company-wide payroll, walkthroughs and analytics; the internal audit pack;
// an audit-report mailer that relays an arbitrary attachment to an arbitrary
// address; and the two invite routes, which send Vantro-branded mail and mint
// access for an outsider.
//
// Every refusal asserts 403 exactly. A 404 here would mean the role check was
// skipped and the request fell through to a job lookup that happened to miss.
//
// No control in this file sends an email: the admin controls cover payroll,
// walkthroughs and analytics only.

import { test, expect } from "@playwright/test"
import {
  assertOnlyTestTenants, baseUrl, createProbe, destroyProbe,
  TENANT_A, type Probe,
} from "./harness"

assertOnlyTestTenants(TENANT_A.id)

let adminA: Probe | null = null
let foremanA: Probe | null = null
let fieldA: Probe | null = null
const stamp = Date.now()
// Never looked up: the role check comes first, so any id will do.
const NO_JOB = "00000000-0000-0000-0000-00000000a013"

test.beforeAll(async () => {
  adminA = await createProbe(TENANT_A.id, "admin", "a13-admin")
  foremanA = await createProbe(TENANT_A.id, "foreman", "a13-foreman")
  fieldA = await createProbe(TENANT_A.id, "field", "a13-field")
})

test.afterAll(async () => {
  await destroyProbe(adminA)
  await destroyProbe(foremanA)
  await destroyProbe(fieldA)
})

function headers(probe: Probe, json = true): Record<string, string> {
  return json
    ? { Cookie: probe.cookie, "Content-Type": "application/json" }
    : { Cookie: probe.cookie }
}

const today = new Date().toISOString().slice(0, 10)
const READS = [
  `/api/payroll?from=${today}T00:00:00Z&to=${today}T23:59:59Z`,
  "/api/walkthroughs",
  "/api/analytics",
]

test("a field session is refused the company-wide dashboard reads", async ({ request }) => {
  expect(fieldA, "probe field user could not be created").not.toBeNull()
  for (const path of READS) {
    const res = await request.get(`${baseUrl()}${path}`, { headers: headers(fieldA!, false), failOnStatusCode: false })
    expect(res.status(), `${path}: ${await res.text()}`).toBe(403)
  }
})

test("an admin still gets the dashboard reads", async ({ request }) => {
  expect(adminA, "probe admin could not be created").not.toBeNull()
  for (const path of READS) {
    const res = await request.get(`${baseUrl()}${path}`, { headers: headers(adminA!, false), failOnStatusCode: false })
    expect(res.status(), `${path}: ${await res.text()}`).toBe(200)
  }
})

test("a field session is refused the internal audit pack, on the session path", async ({ request }) => {
  expect(fieldA, "probe field user could not be created").not.toBeNull()

  let res = await request.post(`${baseUrl()}/api/audit/v2`, {
    headers: headers(fieldA!), data: { jobId: NO_JOB }, failOnStatusCode: false,
  })
  expect(res.status(), `audit/v2: ${await res.text()}`).toBe(403)

  res = await request.get(`${baseUrl()}/api/audit/report?jobId=${NO_JOB}`, {
    headers: headers(fieldA!, false), failOnStatusCode: false,
  })
  expect(res.status(), `audit/report: ${await res.text()}`).toBe(403)
})

test("a field session cannot use the audit report mailer", async ({ request }) => {
  expect(fieldA, "probe field user could not be created").not.toBeNull()
  const res = await request.post(`${baseUrl()}/api/audit/email`, {
    headers: headers(fieldA!, false),
    multipart: {
      to: `security-a13-${stamp}@vantro.test`,
      jobName: "<b>[TEST] a13</b>",
      reportRef: "A13",
      file: { name: "a13.html", mimeType: "text/html", buffer: Buffer.from("<p>[TEST]</p>") },
    },
    failOnStatusCode: false,
  })
  expect(res.status(), `audit/email: ${await res.text()}`).toBe(403)
})

test("field and foreman sessions cannot send invites", async ({ request }) => {
  expect(fieldA, "probe field user could not be created").not.toBeNull()
  expect(foremanA, "probe foreman could not be created").not.toBeNull()
  for (const probe of [fieldA!, foremanA!]) {
    let res = await request.post(`${baseUrl()}/api/invite`, {
      headers: headers(probe),
      data: { email: `security-a13-invite-${stamp}@vantro.test`, name: "[TEST] a13", role: "field" },
      failOnStatusCode: false,
    })
    expect(res.status(), `invite: ${await res.text()}`).toBe(403)

    res = await request.post(`${baseUrl()}/api/client/invite`, {
      headers: headers(probe),
      data: { email: `security-a13-client-${stamp}@vantro.test`, name: "[TEST] a13", jobId: NO_JOB },
      failOnStatusCode: false,
    })
    expect(res.status(), `client/invite: ${await res.text()}`).toBe(403)
  }
})
