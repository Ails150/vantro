// A15. The payroll week lock, end to end, and erasure clearing the frozen file.
//
// On tenant A's LAST week (the only completed week the route will approve):
//   approve -> the frozen Xero timesheet exists and names the worker
//   locked  -> the signins trigger, /api/payroll/edit and /api/jobs/delete all refuse
//   erase   -> the worker's name leaves the frozen file; the week stays locked
//              and the export says why it has no file
//   unlock  -> needs a reason, clears the cleared-markers, logs to audit_log
// Everything it makes is removed afterwards, including the payroll run.

import { test, expect } from "@playwright/test"
import {
  assertOnlyTestTenants, baseUrl, createProbe, destroyProbe, serviceClient, TENANT_A, type Probe,
} from "./harness"

assertOnlyTestTenants(TENANT_A.id)
test.describe.configure({ mode: "serial" })

let admin: Probe | null = null
let worker: Probe | null = null
let jobId = "", shiftId = "", weekStart = ""
const NAME = `[TEST] a15 Worker ${Date.now()}`

/** Monday of last week, London, as the route computes it. */
function lastWeekStart(): string {
  const fmt = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(d)
  const today = new Date(fmt(new Date()) + "T12:00:00Z")
  const dow = (today.getUTCDay() + 6) % 7
  return fmt(new Date(today.getTime() - (dow + 7) * 86400000))
}

const runs = (body: any) => ({ headers: { Cookie: admin!.cookie, "Content-Type": "application/json" }, data: body })

test.beforeAll(async () => {
  const s = serviceClient()
  admin = await createProbe(TENANT_A.id, "admin", "a15-admin")
  worker = await createProbe(TENANT_A.id, "installer", "a15-worker")
  if (worker) await s.from("users").update({ name: NAME }).eq("id", worker.userId)
  weekStart = lastWeekStart()
  const { data: job } = await s.from("jobs")
    .insert({ company_id: TENANT_A.id, name: `[TEST] a15 job ${Date.now()}`, address: "", status: "active", required_trades: [] })
    .select("id").single()
  jobId = (job as any)?.id || ""
  const { data: shift, error } = await s.from("signins").insert({
    company_id: TENANT_A.id, user_id: worker?.userId, job_id: jobId, lat: 51.5, lng: -0.12, within_range: true, 
    signed_in_at: `${weekStart}T08:00:00Z`, signed_out_at: `${weekStart}T16:00:00Z`, hours_worked: 8,
  }).select("id").single()
  if (error) throw new Error(`signins: ${error.message}`)
  shiftId = (shift as any).id
})

test.afterAll(async () => {
  const s = serviceClient()
  if (admin) await s.rpc("payroll_run_unlock", { p_company_id: TENANT_A.id, p_week_start: weekStart, p_user_id: admin.userId, p_reason: "a15 cleanup" })
  if (shiftId) await s.from("signins").delete().eq("id", shiftId).eq("company_id", TENANT_A.id)
  if (jobId) await s.from("jobs").delete().eq("id", jobId).eq("company_id", TENANT_A.id)
  await s.from("payroll_runs").delete().eq("company_id", TENANT_A.id).eq("week_start", weekStart)
  if (worker) await s.from("users").delete().eq("id", worker.userId).eq("company_id", TENANT_A.id)
  await destroyProbe(worker)
  await destroyProbe(admin)
})

test("approving locks the week and freezes the Xero file", async ({ request }) => {
  expect(admin && worker && shiftId, "fixtures could not be created").toBeTruthy()
  const s = serviceClient()

  const open = await request.post(`${baseUrl()}/api/admin/payroll-runs`, runs({ action: "open", week: "last_week" }))
  expect(open.status(), await open.text()).toBe(200)
  const approve = await request.post(`${baseUrl()}/api/admin/payroll-runs`, runs({ action: "approve", week: "last_week" }))
  expect(approve.status(), await approve.text()).toBe(200)

  const { data: run } = await s.from("payroll_runs").select("approved_at, xero_snapshot").eq("company_id", TENANT_A.id).eq("week_start", weekStart).single()
  expect((run as any).approved_at).toBeTruthy()
  expect(String((run as any).xero_snapshot?.csv || ""), "frozen file does not name the worker").toContain(NAME)

  // The database refuses a new shift in the locked week, whoever writes it.
  const { error: trig } = await s.from("signins").insert({
    company_id: TENANT_A.id, user_id: worker!.userId, job_id: jobId, lat: 51.5, lng: -0.12, within_range: true, 
    signed_in_at: `${weekStart}T18:00:00Z`, signed_out_at: `${weekStart}T19:00:00Z`, hours_worked: 1,
  })
  expect(trig, "a shift was inserted into an approved week").not.toBeNull()

  const edit = await request.post(`${baseUrl()}/api/payroll/edit`, runs({ signinId: shiftId, signed_in_at: `${weekStart}T07:00:00Z`, signed_out_at: `${weekStart}T16:00:00Z` }))
  expect(edit.status(), await edit.text()).toBe(423)
  const del = await request.post(`${baseUrl()}/api/jobs/delete`, runs({ jobId }))
  expect(del.status(), await del.text()).toBe(423)
  const { data: still } = await s.from("signins").select("signed_in_at").eq("id", shiftId).single()
  expect(new Date((still as any).signed_in_at).toISOString()).toBe(new Date(`${weekStart}T08:00:00Z`).toISOString())
})

test("erasing the worker clears their name from the frozen file", async ({ request }) => {
  const s = serviceClient()
  const res = await request.post(`${baseUrl()}/api/admin/team/erase`, runs({ userId: worker!.userId, confirmation: NAME }))
  expect(res.status(), await res.text()).toBe(200)
  expect((await res.json()).xeroWeeksCleared).toBeGreaterThanOrEqual(1)

  const { data: run } = await s.from("payroll_runs")
    .select("approved_at, xero_snapshot, xero_snapshot_cleared_reason").eq("company_id", TENANT_A.id).eq("week_start", weekStart).single()
  expect((run as any).approved_at, "erasure unlocked the week").toBeTruthy()
  expect((run as any).xero_snapshot).toBeNull()
  expect((run as any).xero_snapshot_cleared_reason).toBe("erasure")

  const xero = await request.post(`${baseUrl()}/api/payroll/xero`, runs({ weekStart }))
  expect(xero.ok(), "a cleared week still exported").toBe(false)
  expect(await xero.text()).toMatch(/erased/)
})

test("unlocking needs a reason and resets the markers", async ({ request }) => {
  const s = serviceClient()
  const none = await request.post(`${baseUrl()}/api/admin/payroll-runs`, runs({ action: "unlock", week: "last_week", reason: "  " }))
  expect(none.status()).toBe(400)
  const ok = await request.post(`${baseUrl()}/api/admin/payroll-runs`, runs({ action: "unlock", week: "last_week", reason: "a15 live check" }))
  expect(ok.status(), await ok.text()).toBe(200)
  const { data: run } = await s.from("payroll_runs")
    .select("id, approved_at, xero_snapshot_cleared_at, xero_snapshot_cleared_reason").eq("company_id", TENANT_A.id).eq("week_start", weekStart).single()
  expect(run).toMatchObject({ approved_at: null, xero_snapshot_cleared_at: null, xero_snapshot_cleared_reason: null })
  const { data: log } = await s.from("audit_log").select("action, details").eq("entity_id", (run as any).id).eq("action", "payroll_week_unlocked")
  expect((log || []).some((l: any) => l.details?.reason === "a15 live check")).toBe(true)
})
