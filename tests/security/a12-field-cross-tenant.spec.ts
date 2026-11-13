// A12. A company A field token against company B's jobs and walkthroughs.
//
// /api/diary POST, /api/qa GET and /api/walkthroughs/process all ran on the
// service role and trusted the id in the request: a worker in one company could
// file a diary entry (and raise alerts and pushes) on another company's job,
// read another company's checklists and submissions, and have another company's
// walkthrough re-summarised by Gemini with the result written back over theirs.
//
// Every attack asserts on what is left in tenant B afterwards, not just the
// status code. The walkthrough fixture deliberately has no clips: before the
// fix the route answered 400 "No clips" for it, so a regression fails this
// test without ever reaching Gemini. The last test is the control.
//
// Tokens: with JWT_SECRET set, one is minted locally and FIELD_BASE_URL (default
// localhost) is the target, as in a2-b8-field-tokens.spec.ts. Without it, the
// spec gets a REAL token from the target itself: a throwaway tenant A admin
// fetches the company's join link and a new [TEST] worker joins through it.
// That is what lets this run against production, whose secret we do not hold.

import { test, expect } from "@playwright/test"
import jwt from "jsonwebtoken"
import {
  assertOnlyTestTenants, baseUrl, createProbe, destroyProbe, required, serviceClient,
  TENANT_A, TENANT_B, type Probe,
} from "./harness"

assertOnlyTestTenants(TENANT_A.id, TENANT_B.id)

const MINT = !!process.env.JWT_SECRET
function fieldBaseUrl(): string {
  return MINT ? (process.env.FIELD_BASE_URL || "http://localhost:3000") : baseUrl()
}
let joinAdmin: Probe | null = null
let joinedEmail = ""

/** A real field token from the target, through the company's join link. */
async function joinedWorker(): Promise<{ id: string; token: string } | null> {
  joinAdmin = await createProbe(TENANT_A.id, "admin", "a12-join-admin")
  if (!joinAdmin) return null
  const link = await fetch(`${fieldBaseUrl()}/api/admin/invite-link`, { headers: { Cookie: joinAdmin.cookie } })
  if (!link.ok) return null
  const token = String((await link.json()).url || "").split("/join/")[1]
  joinedEmail = `security-a12-${Date.now()}-${Math.floor(Math.random() * 1e6)}@vantro.test`
  const res = await fetch(`${fieldBaseUrl()}/api/join`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, name: "[TEST] a12 worker", email: joinedEmail }),
  })
  if (!res.ok) return null
  const j = await res.json()
  return j.token && j.userId ? { id: j.userId, token: j.token } : null
}

/** Mint a field token the way lib/auth.ts createFieldToken does. */
function mintToken(userId: string, companyId: string) {
  return jwt.sign({ userId, companyId, subcontractorId: null }, required("JWT_SECRET"), { expiresIn: "10h" })
}

const stamp = Date.now()
const MARK = `[TEST] a12 ${stamp}`
const made: Array<{ table: string; id: string; company: string }> = []
let workerA: { id: string; token: string } | null = null
let bJob = "", bWalkthrough = "", aJob = ""

async function mk(table: string, row: Record<string, any>) {
  const { data, error } = await serviceClient().from(table).insert(row).select("id").single()
  if (error) throw new Error(`${table}: ${error.message}`)
  made.push({ table, id: (data as any).id, company: row.company_id })
  return (data as any).id as string
}

test.beforeAll(async () => {
  const s = serviceClient()
  const [{ data: aWorkers }, { data: bUsers }] = await Promise.all([
    s.from("users").select("id").eq("company_id", TENANT_A.id).eq("role", "installer").eq("is_active", true).limit(1),
    s.from("users").select("id").eq("company_id", TENANT_B.id).limit(1),
  ])
  if (MINT) {
    const workerId = aWorkers?.[0]?.id
    if (workerId) workerA = { id: workerId, token: mintToken(workerId, TENANT_A.id) }
  } else {
    workerA = await joinedWorker()
  }

  bJob = await mk("jobs", { company_id: TENANT_B.id, name: `${MARK} b job`, address: "", status: "active", required_trades: [] })
  aJob = await mk("jobs", { company_id: TENANT_A.id, name: `${MARK} a job`, address: "", status: "active", required_trades: [] })
  bWalkthrough = await mk("walkthroughs", {
    company_id: TENANT_B.id,
    job_id: bJob,
    installer_id: bUsers?.[0]?.id ?? null,
    recorded_at: new Date().toISOString(),
    approval_status: "pending",
    processing_status: "pending",
  })
})

test.afterAll(async () => {
  const s = serviceClient()
  // Anything a route wrote against the fixture jobs, then the fixtures.
  for (const job of [aJob, bJob].filter(Boolean)) {
    await s.from("alerts").delete().eq("job_id", job)
    await s.from("diary_entries").delete().eq("job_id", job)
  }
  for (const m of made.reverse()) await s.from(m.table).delete().eq("id", m.id).eq("company_id", m.company)
  if (joinedEmail) {
    await s.from("job_assignments").delete().eq("company_id", TENANT_A.id).eq("user_id", workerA?.id ?? "")
    await s.from("users").delete().eq("email", joinedEmail).eq("company_id", TENANT_A.id)
  }
  await destroyProbe(joinAdmin)
})

function auth(extra: Record<string, string> = {}) {
  return { Authorization: `Bearer ${workerA!.token}`, ...extra }
}

test("a company A field token cannot reach company B's job or walkthrough", async ({ request }) => {
  expect(workerA, "no active installer on tenant A to mint a token for").toBeTruthy()
  const s = serviceClient()

  const diary = await request.post(`${fieldBaseUrl()}/api/diary`, {
    failOnStatusCode: false,
    headers: auth({ "Content-Type": "application/json" }),
    data: { jobId: bJob, entryText: `${MARK} injected`, workStatus: "stopped" },
  })
  expect(diary.status(), `diary POST: ${await diary.text()}`).toBe(404)

  const qa = await request.get(`${fieldBaseUrl()}/api/qa?jobId=${bJob}`, {
    failOnStatusCode: false,
    headers: auth(),
  })
  expect(qa.status(), `qa GET: ${await qa.text()}`).toBe(404)

  const proc = await request.post(`${fieldBaseUrl()}/api/walkthroughs/process`, {
    failOnStatusCode: false,
    headers: auth({ "Content-Type": "application/json" }),
    data: { walkthroughId: bWalkthrough },
  })
  expect(proc.status(), `walkthroughs/process: ${await proc.text()}`).toBe(404)

  // Tenant B is unchanged.
  const { count: entries } = await s.from("diary_entries").select("id", { count: "exact", head: true }).eq("job_id", bJob)
  expect(entries, "a diary entry was written on tenant B's job").toBe(0)
  const { count: alerts } = await s.from("alerts").select("id", { count: "exact", head: true }).eq("job_id", bJob)
  expect(alerts, "an alert was raised on tenant B's job").toBe(0)
  const { data: wt } = await s.from("walkthroughs").select("ai_summary, transcript_full, company_id").eq("id", bWalkthrough).maybeSingle()
  expect(wt, "tenant B's walkthrough disappeared").not.toBeNull()
  expect((wt as any).company_id).toBe(TENANT_B.id)
  expect((wt as any).ai_summary, "tenant B's walkthrough summary was written").toBeNull()
  expect((wt as any).transcript_full ?? null, "tenant B's walkthrough transcript was written").toBeNull()
})

// The control. Without it, a route that refused everything would pass above.
test("the same token can still write a diary entry on its own company's job", async ({ request }) => {
  expect(workerA, "no active installer on tenant A to mint a token for").toBeTruthy()
  const res = await request.post(`${fieldBaseUrl()}/api/diary`, {
    failOnStatusCode: false,
    headers: auth({ "Content-Type": "application/json" }),
    data: { jobId: aJob, entryText: `${MARK} own entry`, workStatus: "carrying_on" },
  })
  expect(res.status(), `diary POST own job: ${await res.text()}`).toBe(200)
  const { data: rows } = await serviceClient().from("diary_entries")
    .select("id, company_id, user_id").eq("job_id", aJob)
  expect(rows?.length, "the control entry was not written").toBe(1)
  expect((rows as any)[0].company_id).toBe(TENANT_A.id)
  expect((rows as any)[0].user_id).toBe(workerA!.id)
})
