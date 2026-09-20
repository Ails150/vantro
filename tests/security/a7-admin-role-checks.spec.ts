import { test, expect } from "@playwright/test"
import fs from "fs"
import path from "path"
import {
  TENANT_A, baseUrl, createProbe, destroyProbe, enumerateApiRoutes, type Probe,
} from "./harness"
import { DASHBOARD_ROLES, OWNER_ROLES, isDashboardRole } from "../../lib/company-context"

/**
 * A7 -- every admin route checks the caller's ROLE, not just their session.
 *
 * A1 proves a signed-in admin of one company cannot reach another company's
 * data. That is the horizontal question. This is the vertical one, and they
 * fail differently: company scoping stops you reading somebody ELSE'S company,
 * and does nothing at all about reading your OWN company's management view from
 * the shop floor.
 *
 * Two routes were doing exactly that -- authenticated, correctly scoped by
 * company, no role check:
 *
 *   /api/admin/alerts          every geofence breach, late sign-in and flagged
 *                              diary entry, with the worker's own video and
 *                              photographs attached
 *   /api/admin/diary-insights  the company's diary entries sent to Gemini and
 *                              returned as a summary of what the crews have
 *                              been complaining about and who is raising it
 *
 * "Installers do not get a Supabase session" is why it went unnoticed, and it
 * is a habit rather than a control: app/auth/callback has a branch that routes
 * a signed-in installer to /installer/setup, so some of them plainly do.
 */

let installer: Probe | null = null
let foreman: Probe | null = null

test.beforeAll(async () => {
  // A field-role account that nonetheless holds a dashboard session. The whole
  // point is that this is possible.
  installer = await createProbe(TENANT_A.id, "installer", "a7-installer")
  foreman = await createProbe(TENANT_A.id, "foreman", "a7-foreman")
})

test.afterAll(async () => {
  await destroyProbe(installer)
  await destroyProbe(foreman)
})

test("the setup is real", () => {
  expect(installer, "no installer probe; every assertion below is vacuous").not.toBeNull()
  expect(foreman, "no foreman probe; there would be no control").not.toBeNull()
})

test.describe("A7: the role lists", () => {
  test("field roles are not dashboard roles", () => {
    expect(isDashboardRole("installer")).toBe(false)
    expect(isDashboardRole("subcontractor")).toBe(false)
    expect(isDashboardRole(null)).toBe(false)
    expect(isDashboardRole("")).toBe(false)
    expect(isDashboardRole("ADMIN"), "role matching is case sensitive on purpose").toBe(false)
  })

  test("dashboard roles are", () => {
    for (const role of DASHBOARD_ROLES) expect(isDashboardRole(role)).toBe(true)
  })

  test("owner roles are a subset of dashboard roles", () => {
    // A foreman may see the dashboard and may not change the company's money or
    // people. If OWNER drifted outside DASHBOARD the two lists would disagree
    // about somebody.
    for (const role of OWNER_ROLES) {
      expect(isDashboardRole(role), `${role} owns things but cannot sign in`).toBe(true)
    }
    expect(OWNER_ROLES).not.toContain("foreman")
  })
})

test.describe("A7: an installer with a session reaches no admin route", () => {
  const ADMIN_READS = [
    "/api/admin/alerts",
    "/api/admin/diary-insights",
    "/api/admin/team",
    "/api/admin/signins",
    "/api/admin/time-report",
    "/api/admin/pay-rules",
    "/api/admin/expenses",
    "/api/admin/map",
  ]

  for (const route of ADMIN_READS) {
    test(`${route} refuses an installer`, async () => {
      const res = await fetch(`${baseUrl()}${route}`, {
        headers: { Cookie: installer!.cookie },
      })
      expect(
        [401, 403, 404],
        `${route} answered ${res.status} to an installer with a session`,
      ).toContain(res.status)
    })
  }

  test("and a foreman is NOT refused the dashboard reads", async () => {
    // The control. Without it, every assertion above would pass on routes that
    // refuse everybody, which is an outage rather than an access control.
    const res = await fetch(`${baseUrl()}/api/admin/alerts`, {
      headers: { Cookie: foreman!.cookie },
    })
    expect(res.status, "a foreman cannot see the alerts feed").toBe(200)
  })

  test("the two that were unguarded are specifically covered", async () => {
    // Named, because these are the ones that were actually open and a
    // regression here is a repeat rather than a new bug.
    for (const route of ["/api/admin/alerts", "/api/admin/diary-insights"]) {
      const res = await fetch(`${baseUrl()}${route}`, {
        headers: { Cookie: installer!.cookie },
      })
      expect(res.status, `${route} is open to installers again`).toBe(403)
    }
  })
})

test.describe("A7: no admin route is left without a check", () => {
  const adminRoutes = enumerateApiRoutes({
    defaultId: "00000000-0000-4000-8000-000000000000",
    defaultToken: "probe",
  }).filter(r => r.pattern.startsWith("/api/admin"))

  test("the enumeration found them", () => {
    expect(adminRoutes.length, "no admin routes enumerated").toBeGreaterThan(40)
  })

  /**
   * Routes that legitimately act on the CALLER rather than on the company.
   *
   * /api/admin/account changes the caller's own display name. A role check
   * there would be theatre: there is no privilege to escalate, because the only
   * row it can touch is the one belonging to the session making the request.
   */
  const SELF_SERVICE = ["/api/admin/account"]

  test("every other admin route consults the caller's role", () => {
    const offenders: string[] = []
    for (const route of adminRoutes) {
      if (SELF_SERVICE.includes(route.pattern)) continue
      const src = fs.readFileSync(path.join(process.cwd(), route.file), "utf8")
      // suiteCaller() is lib/suite-caller.ts: it resolves the caller, refuses
      // anyone outside OWNER_ROLES and then checks the company's plan. A route
      // that delegates to it has a stricter check than most of the inline
      // ones, and this sweep could not see it -- five routes were reported
      // unguarded while in fact refusing every non-owner. The helper is named
      // here rather than the pattern loosened, and the test below proves the
      // helper still does what its name is being trusted for.
      const checksRole =
        /isDashboardRole|DASHBOARD_ROLES|OWNER_ROLES|suiteCaller/.test(src) ||
        /\.role\b/.test(src)
      if (!checksRole) offenders.push(route.pattern)
    }
    expect(
      offenders,
      `admin routes with no role check: ${offenders.join(", ")}`,
    ).toEqual([])
  })

  test("the helper the sweep trusts really does refuse a non-owner", () => {
    // Trusting a helper by name is only safe if the helper is checked. Without
    // this, adding "suiteCaller" to the pattern above would be a way to make
    // this suite quiet rather than a way to describe the control.
    const helper = fs.readFileSync(path.join(process.cwd(), "lib/suite-caller.ts"), "utf8")
    expect(helper, "suite-caller no longer consults OWNER_ROLES").toMatch(/OWNER_ROLES/)
    expect(helper, "suite-caller no longer refuses with 403").toMatch(/403/)
  })

  test("the self-service exemption is exactly one route, and it is self-service", () => {
    // The list most likely to be abused to make this suite pass. Anything added
    // to it has to still be a route that can only touch the caller's own row.
    expect(SELF_SERVICE).toEqual(["/api/admin/account"])
    const src = fs.readFileSync(
      path.join(process.cwd(), "app", "api", "admin", "account", "route.ts"), "utf8",
    )
    expect(src).toMatch(/eq\("auth_user_id",\s*user\.id\)/)
    expect(src, "the self-service route now touches more than the caller's row")
      .not.toMatch(/company_id|\.in\(/)
  })
})
