import { test, expect } from "@playwright/test"
import {
  TENANT_A, assertOnlyTestTenants, baseUrl, createProbe, destroyProbe, serviceClient, type Probe,
} from "./harness"
import { FIELD_ROLE } from "../../lib/roles"

/**
 * B14 -- Forgot PIN is not a way round the office-account control.
 *
 * B13 asserts that setup-pin refuses to put a PIN on an admin. Forgot PIN
 * reached the same end by a longer road: it looked a user up by address with
 * no role check at all, wrote a seven-day reset token on that row, and emailed
 * a link that set a four-digit PIN. A PIN on an office account mints a field
 * token in that person's name -- their company, their jobs, sign-ins recorded
 * against them.
 *
 * Both halves are checked, because they fail independently: the route that
 * ISSUES a token, and the route that SPENDS one. A token already sitting on an
 * office row from before the control existed must not still work.
 *
 * The refusal has to be indistinguishable from the unknown-address answer.
 * This suite therefore asserts the RESPONSE is identical and the DATABASE is
 * untouched, rather than looking for an error message -- an error message
 * would itself be the leak.
 */

let admin: Probe | null = null
const createdEmails: string[] = []

test.beforeAll(async () => {
  assertOnlyTestTenants(TENANT_A.id)
  admin = await createProbe(TENANT_A.id, "admin", "b14-admin")
})

test.afterAll(async () => {
  const service = serviceClient()
  for (const email of createdEmails) {
    await service.from("users").delete().eq("email", email).eq("company_id", TENANT_A.id)
  }
  await destroyProbe(admin)
})

test("the setup is real", () => {
  expect(admin, "no admin probe; every assertion below is vacuous").not.toBeNull()
})

test("an admin is refused a PIN reset, silently, and nothing is written", async ({ request }) => {
  test.skip(!admin, "no admin probe")
  const service = serviceClient()

  const res = await request.post(`${baseUrl()}/api/installer/reset-pin`, {
    data: { email: admin!.email },
  })
  // Same answer as an address nobody has heard of: 200 {success:true}.
  expect(res.status()).toBe(200)
  expect(await res.json()).toEqual({ success: true })

  const { data } = await service
    .from("users").select("pin_reset_token, pin_reset_expires, pin_hash").eq("id", admin!.userId).single()
  expect(data?.pin_reset_token, "a reset token was minted for an admin").toBeNull()
  expect(data?.pin_reset_expires).toBeNull()
  expect(data?.pin_hash, "a PIN reached an admin account").toBeNull()
})

test("an unknown address gets the identical answer", async ({ request }) => {
  const res = await request.post(`${baseUrl()}/api/installer/reset-pin`, {
    data: { email: `b14-nobody-${Date.now()}@vantro.test` },
  })
  expect(res.status()).toBe(200)
  expect(await res.json(), "the two refusals must be indistinguishable").toEqual({ success: true })
})

test("a token already sitting on an admin row cannot be spent", async ({ request }) => {
  test.skip(!admin, "no admin probe")
  const service = serviceClient()
  const token = `b14-token-${Date.now()}`
  await service.from("users").update({
    pin_reset_token: token,
    pin_reset_expires: new Date(Date.now() + 3600_000).toISOString(),
  }).eq("id", admin!.userId)

  const res = await request.post(`${baseUrl()}/api/installer/reset-pin/confirm`, {
    data: { token, pin: "9182" },
  })
  expect(res.status(), "an admin's reset token set a PIN").toBe(400)
  // The same words a bogus token gets.
  expect((await res.json()).error).toBe("Invalid or expired reset link")

  const { data } = await service.from("users").select("pin_hash").eq("id", admin!.userId).single()
  expect(data?.pin_hash, "a PIN was written to an admin account").toBeNull()

  await service.from("users").update({ pin_reset_token: null, pin_reset_expires: null }).eq("id", admin!.userId)
})

test("a field worker can still reset their PIN -- the control is not a wall for everyone", async ({ request }) => {
  const service = serviceClient()
  const email = `b14-worker-${Date.now()}@vantro.test`
  const { error } = await service.from("users").insert({
    company_id: TENANT_A.id, email, name: "[TEST] B14 Worker", initials: "BW",
    role: FIELD_ROLE, is_active: true,
  })
  expect(error, error?.message).toBeNull()
  createdEmails.push(email)

  const res = await request.post(`${baseUrl()}/api/installer/reset-pin`, { data: { email } })
  expect(res.status()).toBe(200)

  const { data } = await service.from("users").select("pin_reset_token").eq("email", email).single()
  expect(data?.pin_reset_token, "a worker was refused a reset they are entitled to").not.toBeNull()

  // And the token they were issued actually works.
  const confirm = await request.post(`${baseUrl()}/api/installer/reset-pin/confirm`, {
    data: { token: data!.pin_reset_token, pin: "3391" },
  })
  expect(confirm.status(), await confirm.text()).toBe(200)

  const auth = await request.post(`${baseUrl()}/api/installer/auth`, { data: { email, pin: "3391" } })
  expect(auth.status(), "the reset PIN does not sign in").toBe(200)
  expect(typeof (await auth.json()).token).toBe("string")
})
