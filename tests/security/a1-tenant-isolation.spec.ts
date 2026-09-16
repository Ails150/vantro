// A1. Company A admin against company B ids, on every route.
// A2. Company A worker token against company B resources.
// A6. A plain admin cannot escalate their own role or reach platform features.
//
// The routes are enumerated off the filesystem so none is missed. Tenant B ids
// are pushed into the path, the query string and the body of every one.
//
// WHAT COUNTS AS A PASS. Not merely a non-200: a route that answers 200 with an
// empty list is refusing correctly, and insisting on 403 everywhere would be
// asking the product to confirm what exists in another tenant. So the assertion
// is about CONTENT -- no tenant B identifier may appear in any response.

import { test, expect, type APIRequestContext } from "@playwright/test"
import {
  assertOnlyTestTenants, baseUrl, createProbe, destroyProbe, enumerateApiRoutes,
  serviceClient, TENANT_A, TENANT_B, type Probe,
} from "./harness"

assertOnlyTestTenants(TENANT_A.id, TENANT_B.id)

let adminA: Probe | null = null
/** Distinctive strings from tenant B that must never come back. */
let tenantBMarkers: string[] = []
let tenantBIds: Record<string, string> = {}

test.beforeAll(async () => {
  adminA = await createProbe(TENANT_A.id, "admin", "a1-admin-a")

  // Real tenant B ids to attack with, and the markers that prove a leak.
  const service = serviceClient()
  const [{ data: jobs }, { data: users }, { data: signins }] = await Promise.all([
    service.from("jobs").select("id, name").eq("company_id", TENANT_B.id).limit(1),
    service.from("users").select("id, name").eq("company_id", TENANT_B.id).limit(1),
    service.from("signins").select("id").eq("company_id", TENANT_B.id).limit(1),
  ])

  tenantBIds = {
    defaultId: jobs?.[0]?.id || TENANT_B.id,
    defaultToken: "probe-token",
    id: jobs?.[0]?.id || TENANT_B.id,
    jobid: jobs?.[0]?.id || TENANT_B.id,
    userid: users?.[0]?.id || TENANT_B.id,
    token: "probe-token",
  }

  tenantBMarkers = [
    TENANT_B.id,
    TENANT_B.name,
    jobs?.[0]?.id,
    jobs?.[0]?.name,
    users?.[0]?.id,
    signins?.[0]?.id,
  ].filter(Boolean) as string[]
})

test.afterAll(async () => {
  await destroyProbe(adminA)
})

/**
 * Call a route as a real session, pushing tenant B ids everywhere.
 *
 * COOKIE, not Authorization. The app uses @supabase/ssr and ignores bearer
 * tokens entirely -- an earlier version of this file sent one, every route
 * answered 401, and every assertion below passed while testing nothing.
 */
async function callAs(
  request: APIRequestContext,
  cookie: string,
  method: string,
  url: string,
): Promise<{ status: number; body: string }> {
  const opts: any = {
    failOnStatusCode: false,
    timeout: 30_000,
    headers: { Cookie: cookie },
  }
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    opts.headers["Content-Type"] = "application/json"
    opts.data = {
      companyId: TENANT_B.id,
      company_id: TENANT_B.id,
      jobId: tenantBIds.jobid,
      userId: tenantBIds.userid,
      id: tenantBIds.id,
    }
  }
  const res = await (request as any)[method.toLowerCase()](url, opts)
  let body = ""
  try { body = await res.text() } catch { /* empty */ }
  return { status: res.status(), body }
}

function leakedMarkers(body: string): string[] {
  const lower = body.toLowerCase()
  return tenantBMarkers.filter(m => lower.includes(String(m).toLowerCase()))
}

test.describe("A1: company A admin cannot reach company B through any route", () => {
  test("the probe session actually authenticates (guard against a vacuous sweep)", async ({ request }) => {
    // Without this, a sweep in which every route answers 401 passes every
    // isolation assertion while proving nothing. This asserts the session is
    // real BEFORE the sweep is allowed to mean anything.
    expect(adminA, "no probe session").toBeTruthy()
    const res = await request.get(`${baseUrl()}/api/admin/me`, {
      failOnStatusCode: false,
      headers: { Cookie: adminA!.cookie },
    })
    expect(res.status(), "the probe cookie did not authenticate").toBe(200)
    const body = await res.json()
    expect(body.companyId, "the probe is not on tenant A").toBe(TENANT_A.id)
    expect(body.role).toBe("admin")
  })

  test("no route returns a company B identifier", async ({ request }) => {
    // Fails rather than skips. A security suite that skips when its own setup
    // breaks reports green while testing nothing.
    expect(adminA, "could not create the tenant A admin probe").toBeTruthy()
    expect(tenantBMarkers.length, "no tenant B markers to detect a leak with")
      .toBeGreaterThan(1)

    const routes = enumerateApiRoutes(tenantBIds)
    const leaks: string[] = []

    for (const route of routes) {
      // Cron routes carry a secret rather than a session and are covered by B11.
      if (route.pattern.startsWith("/api/cron")) continue

      for (const method of route.methods) {
        // Query string as well as path and body.
        const url =
          `${baseUrl()}${route.path}` +
          `?companyId=${TENANT_B.id}&jobId=${tenantBIds.jobid}&userId=${tenantBIds.userid}&id=${tenantBIds.id}`

        const { status, body } = await callAs(request, adminA!.cookie, method, url)
        const found = leakedMarkers(body)
        if (found.length > 0) {
          leaks.push(`${method} ${route.pattern} [${status}] leaked: ${found.join(", ")}`)
        }
      }
    }

    expect(leaks, `tenant B data reachable by a tenant A admin:\n${leaks.join("\n")}`)
      .toEqual([])
  })

  test("no route lets company A WRITE into company B", async ({ request }) => {
    expect(adminA, "could not create the tenant A admin probe").toBeTruthy()

    const service = serviceClient()
    const before = await countTenantB(service)

    const routes = enumerateApiRoutes(tenantBIds).filter(
      r => !r.pattern.startsWith("/api/cron"),
    )
    for (const route of routes) {
      for (const method of route.methods.filter(m => ["POST", "PUT", "PATCH"].includes(m))) {
        await callAs(request, adminA!.cookie, method, `${baseUrl()}${route.path}`)
      }
    }

    const after = await countTenantB(service)
    const grew = Object.keys(after).filter(t => after[t] > before[t])
    expect(
      grew.map(t => `${t}: ${before[t]} -> ${after[t]}`),
      `tenant A created rows in tenant B:\n${grew.join("\n")}`,
    ).toEqual([])
  })
})

async function countTenantB(service: any): Promise<Record<string, number>> {
  const tables = ["jobs", "users", "signins", "diary_entries", "defects", "incidents", "alerts"]
  const counts: Record<string, number> = {}
  for (const t of tables) {
    const { count } = await service
      .from(t).select("id", { count: "exact", head: true }).eq("company_id", TENANT_B.id)
    counts[t] = count ?? 0
  }
  return counts
}

test.describe("A6: a plain admin cannot promote themselves or reach platform features", () => {
  test("cannot set their own role to superadmin", async ({ request }) => {
    expect(adminA, "no probe").toBeTruthy()
    const service = serviceClient()

    for (const [path, method, body] of [
      ["/api/admin/team", "PATCH", { userId: adminA!.userId, role: "superadmin" }],
      ["/api/admin/team", "PATCH", { userId: adminA!.userId, hourly_rate: 1, role: "superadmin" }],
      ["/api/admin/account", "POST", { role: "superadmin" }],
      ["/api/admin/settings", "POST", { role: "superadmin" }],
    ] as Array<[string, string, any]>) {
      await (request as any)[method.toLowerCase()](`${baseUrl()}${path}`, {
        failOnStatusCode: false,
        headers: { Cookie: adminA!.cookie, "Content-Type": "application/json" },
        data: body,
      })
    }

    const { data: after } = await service
      .from("users").select("role").eq("id", adminA!.userId).single()
    expect((after as any)?.role, "a plain admin escalated their own role").toBe("admin")
  })

  test("cannot run Load demo, which rebuilds an entire tenant", async ({ request }) => {
    expect(adminA, "no probe").toBeTruthy()
    const res = await request.post(`${baseUrl()}/api/admin/seed-demo`, {
      failOnStatusCode: false,
      headers: { Cookie: adminA!.cookie },
    })
    expect([401, 403]).toContain(res.status())
  })

  test("cannot switch company by setting the support cookie", async ({ request }) => {
    expect(adminA, "no probe").toBeTruthy()
    // The support switcher reads a cookie. A non-support user setting it by
    // hand must not move them into another tenant.
    const res = await request.get(`${baseUrl()}/api/admin/me`, {
      failOnStatusCode: false,
      headers: {
        Cookie: `${adminA!.cookie}; vantro_support_company=${TENANT_B.id}`,
      },
    })
    const body = await res.text()
    expect(body, "the support cookie moved a plain admin into another tenant")
      .not.toContain(TENANT_B.id)
  })
})
