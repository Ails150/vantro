import { test, expect } from "@playwright/test"
import {
  TENANT_A, assertOnlyTestTenants, baseUrl, createProbe, destroyProbe, serviceClient, type Probe,
} from "./harness"
import { FIELD_ROLE, canHoldPin } from "../../lib/roles"

/**
 * B13 -- who may hold a PIN, and the lockout that hid inside that question.
 *
 * Two failures meet on this route and they pull in opposite directions:
 *
 *   THE LOCKOUT. setup-pin allowed ['installer', 'subcontractor'], written out
 *   by hand. Every worker added through /api/admin/team, the CSV import or
 *   /api/onboarding is stored as 'field'. So a worker added the normal way was
 *   refused a PIN and could not log in at all -- the product's own setup
 *   wizard produced accounts that did not work.
 *
 *   THE HOLE. The same check is the only thing stopping anybody who knows an
 *   admin's email address from setting a PIN on that account and minting a
 *   field token with it. Widening the list to fix the lockout must not widen
 *   it to office accounts.
 *
 * So this suite asserts both directions on the live routes: a 'field' worker
 * can complete setup and sign in; an admin cannot, by either path.
 *
 * Every write is confined to the [TEST] tenant, and the worker rows it creates
 * are deleted afterwards.
 */

const PIN = "4712"
let admin: Probe | null = null
const createdEmails: string[] = []

async function cleanupWorkers() {
  if (createdEmails.length === 0) return
  const service = serviceClient()
  for (const email of createdEmails) {
    await service.from("users").delete().eq("email", email).eq("company_id", TENANT_A.id)
  }
  createdEmails.length = 0
}

test.beforeAll(async () => {
  assertOnlyTestTenants(TENANT_A.id)
  admin = await createProbe(TENANT_A.id, "admin", "b13-admin")
})

test.afterAll(async () => {
  await cleanupWorkers()
  await destroyProbe(admin)
})

test("the setup is real", () => {
  expect(admin, "no admin probe; every assertion below is vacuous").not.toBeNull()
})

test.describe("B13: the allowlist itself", () => {
  test("the roles a worker is actually stored with can hold a PIN", () => {
    // 'field' is what every server-side add writes today; 'installer' is the
    // legacy value still on 427 production rows.
    expect(canHoldPin("field")).toBe(true)
    expect(canHoldPin("installer")).toBe(true)
    expect(canHoldPin("subcontractor")).toBe(true)
    expect(canHoldPin("foreman")).toBe(true)
  })

  test("office roles cannot", () => {
    expect(canHoldPin("admin")).toBe(false)
    expect(canHoldPin("superadmin")).toBe(false)
    expect(canHoldPin("support")).toBe(false)
    expect(canHoldPin(null)).toBe(false)
    expect(canHoldPin("")).toBe(false)
    expect(canHoldPin("ADMIN"), "matching is case sensitive, as everywhere else").toBe(false)
  })
})

test.describe("B13: a worker added through /api/admin/team can actually log in", () => {
  test("added, PIN set, token issued, token works", async ({ request }) => {
    test.skip(!admin, "no admin probe")
    const email = `b13-worker-${Date.now()}@vantro.test`

    // 1. Added the way the wizard's team step adds people.
    const added = await request.post(`${baseUrl()}/api/admin/team`, {
      headers: { Cookie: admin!.cookie, "Content-Type": "application/json" },
      data: { name: "[TEST] B13 Worker", email, role: FIELD_ROLE },
    })
    expect(added.status(), await added.text()).toBe(200)
    createdEmails.push(email)

    // The stored role is the new vocabulary. If this ever goes back to
    // 'installer' the lockout is gone but so is the reconciliation.
    const service = serviceClient()
    const { data: row } = await service.from("users").select("id, role, company_id").eq("email", email).single()
    expect(row?.company_id).toBe(TENANT_A.id)
    expect(row?.role).toBe(FIELD_ROLE)

    // 2. PIN setup, the documented email path. This is what used to 401.
    const setup = await request.post(`${baseUrl()}/api/installer/setup-pin`, {
      data: { email, pin: PIN },
    })
    expect(setup.status(), `PIN setup refused a '${row?.role}' worker: ${await setup.text()}`).toBe(200)

    // 3. The PIN gets them a field token.
    const auth = await request.post(`${baseUrl()}/api/installer/auth`, { data: { email, pin: PIN } })
    expect(auth.status(), await auth.text()).toBe(200)
    const token = (await auth.json()).token
    expect(typeof token, "no field token issued").toBe("string")

    // 4. The token is accepted by a field route. A token that opens nothing
    //    would pass step 3 and still leave the worker unable to work.
    const jobs = await request.get(`${baseUrl()}/api/installer/jobs`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(jobs.status(), await jobs.text()).toBe(200)
    expect(Array.isArray((await jobs.json()).jobs)).toBe(true)
  })

  test("the legacy 'installer' value still works during the compatibility window", async ({ request }) => {
    const email = `b13-legacy-${Date.now()}@vantro.test`
    const service = serviceClient()
    const { error } = await service.from("users").insert({
      company_id: TENANT_A.id, email, name: "[TEST] B13 Legacy", initials: "BL",
      role: "installer", is_active: true,
    })
    expect(error, error?.message).toBeNull()
    createdEmails.push(email)

    const setup = await request.post(`${baseUrl()}/api/installer/setup-pin`, { data: { email, pin: PIN } })
    expect(setup.status(), await setup.text()).toBe(200)
  })
})

test.describe("B13: an office account is still refused", () => {
  test("setup-pin refuses an admin by email", async ({ request }) => {
    test.skip(!admin, "no admin probe")
    const res = await request.post(`${baseUrl()}/api/installer/setup-pin`, {
      data: { email: admin!.email, pin: PIN },
    })
    expect(res.status(), "an admin was allowed to set a PIN").toBe(401)

    // And nothing was written, whatever the status said.
    const service = serviceClient()
    const { data } = await service.from("users").select("pin_hash").eq("id", admin!.userId).single()
    expect(data?.pin_hash, "a PIN was set on an admin account").toBeNull()
  })

  test("setup-pin refuses an admin holding a reset token", async ({ request }) => {
    test.skip(!admin, "no admin probe")
    // The token path never checked the role at all: a token minted for an
    // office account would have set a PIN on it.
    const service = serviceClient()
    const token = `b13-token-${Date.now()}`
    await service.from("users").update({
      pin_reset_token: token,
      pin_reset_expires: new Date(Date.now() + 3600_000).toISOString(),
    }).eq("id", admin!.userId)

    const res = await request.post(`${baseUrl()}/api/installer/setup-pin`, { data: { token, pin: PIN } })
    expect(res.status(), "an admin's reset token set a PIN").toBe(401)

    const { data } = await service.from("users").select("pin_hash").eq("id", admin!.userId).single()
    expect(data?.pin_hash, "a PIN was set on an admin account through the token path").toBeNull()
    await service.from("users").update({ pin_reset_token: null, pin_reset_expires: null }).eq("id", admin!.userId)
  })
})
