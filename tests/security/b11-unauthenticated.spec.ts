// B11. Every cron route refuses without the secret.
//      Every admin route refuses without a session.
//
// The routes are enumerated off the filesystem, so a route added next month
// with no auth check fails this suite by itself. That is the whole point: a
// hand-written list is a list of the routes somebody remembered.

import { test, expect, type APIRequestContext } from "@playwright/test"
import {
  baseUrl, enumerateApiRoutes, isIntentionallyPublic, isRefusal, PROBE_BODY,
  TENANT_B,
} from "./harness"

const IDS = {
  defaultId: TENANT_B.id,
  defaultToken: "probe-token",
  jobid: TENANT_B.id,
  id: TENANT_B.id,
  token: "probe-token",
  userid: TENANT_B.id,
}

const routes = enumerateApiRoutes(IDS)

/** Call a route with no credentials at all. */
async function callAnonymously(
  request: APIRequestContext,
  method: string,
  url: string,
): Promise<{ status: number; body: string }> {
  const opts: any = { failOnStatusCode: false, timeout: 30_000 }
  if (["POST", "PUT", "PATCH"].includes(method)) {
    opts.data = PROBE_BODY
    opts.headers = { "Content-Type": "application/json" }
  }
  const res = await (request as any)[method.toLowerCase()](url, opts)
  let body = ""
  try { body = (await res.text()).slice(0, 400) } catch { /* empty body is fine */ }
  return { status: res.status(), body }
}

test.describe("B11: nothing sensitive answers an anonymous caller", () => {
  test("the route enumeration actually found the API", () => {
    // If this is near zero the rest of the suite is silently passing on an
    // empty list, which would be the worst possible failure mode for it.
    expect(routes.length).toBeGreaterThan(40)
    expect(routes.some(r => r.pattern.startsWith("/api/admin"))).toBe(true)
    expect(routes.some(r => r.pattern.startsWith("/api/cron"))).toBe(true)
  })

  test("every /api/cron route refuses without CRON_SECRET", async ({ request }) => {
    const cronRoutes = routes.filter(r => r.pattern.startsWith("/api/cron"))
    expect(cronRoutes.length).toBeGreaterThan(0)

    const failures: string[] = []
    for (const route of cronRoutes) {
      for (const method of route.methods) {
        const { status, body } = await callAnonymously(
          request, method, `${baseUrl()}${route.path}`,
        )
        if (!isRefusal(status)) {
          failures.push(`${method} ${route.pattern} -> ${status} ${body.slice(0, 120)}`)
        }
      }
    }
    expect(failures, `cron routes reachable without the secret:\n${failures.join("\n")}`)
      .toEqual([])
  })

  test("every /api/admin route refuses without a session", async ({ request }) => {
    const adminRoutes = routes.filter(r => r.pattern.startsWith("/api/admin"))
    expect(adminRoutes.length).toBeGreaterThan(10)

    const failures: string[] = []
    for (const route of adminRoutes) {
      for (const method of route.methods) {
        const { status, body } = await callAnonymously(
          request, method, `${baseUrl()}${route.path}`,
        )
        if (!isRefusal(status)) {
          failures.push(`${method} ${route.pattern} -> ${status} ${body.slice(0, 120)}`)
        }
      }
    }
    expect(failures, `admin routes reachable anonymously:\n${failures.join("\n")}`)
      .toEqual([])
  })

  test("every other non-public route refuses without a session", async ({ request }) => {
    // Everything that is not /api/admin, not /api/cron, and not on the
    // intentionally-public list. This is where a forgotten route hides.
    const others = routes.filter(
      r =>
        !r.pattern.startsWith("/api/admin") &&
        !r.pattern.startsWith("/api/cron") &&
        !isIntentionallyPublic(r.pattern),
    )

    const failures: string[] = []
    for (const route of others) {
      for (const method of route.methods) {
        const { status, body } = await callAnonymously(
          request, method, `${baseUrl()}${route.path}`,
        )
        if (!isRefusal(status)) {
          failures.push(`${method} ${route.pattern} -> ${status} ${body.slice(0, 160)}`)
        }
      }
    }
    expect(failures, `routes reachable anonymously:\n${failures.join("\n")}`)
      .toEqual([])
  })

  test("a refusal never leaks data in its body", async ({ request }) => {
    // A 403 that explains which company it belongs to is still a leak.
    const sample = routes
      .filter(r => !isIntentionallyPublic(r.pattern))
      .slice(0, 60)

    const leaks: string[] = []
    for (const route of sample) {
      const { body } = await callAnonymously(request, route.methods[0], `${baseUrl()}${route.path}`)
      const lower = body.toLowerCase()
      for (const marker of ["bannon", "holts", "@getvantro.com", "service_role", "eyj"]) {
        if (lower.includes(marker)) {
          leaks.push(`${route.pattern} leaked "${marker}": ${body.slice(0, 160)}`)
        }
      }
    }
    expect(leaks, leaks.join("\n")).toEqual([])
  })
})
