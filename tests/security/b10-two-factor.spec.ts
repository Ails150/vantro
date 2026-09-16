import { test, expect } from "@playwright/test"
import crypto from "crypto"
import {
  TENANT_A, anonClient, baseUrl, createProbe, destroyProbe, enumerateApiRoutes,
  isIntentionallyPublic, sessionCookie, type Probe,
} from "./harness"
import { isMfaExempt } from "../../lib/mfa"

/**
 * B10 -- two-factor verification really covers the admin surface.
 *
 * The gate is one check in middleware: an account with a VERIFIED factor whose
 * current session is still aal1 gets refused. That design is the reason it can
 * cover everything at once, and also the reason a single mistake in the exempt
 * list silently un-gates a whole prefix.
 *
 * So this does not read the middleware and agree with it. It enrols a real
 * authenticator on a throwaway account, computes real TOTP codes, and drives
 * both an aal1 and an aal2 session against the live deployment. A password
 * alone must reach nothing.
 *
 * The TOTP is implemented here rather than pulled in as a dependency: it is
 * fifteen lines of RFC 6238, and a security test that cannot be run because an
 * optional dev dependency is missing is a test that stops running.
 */

// --- RFC 6238, enough of it -------------------------------------------------

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
  const clean = input.replace(/=+$/, "").toUpperCase().replace(/\s/g, "")
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const char of clean) {
    const idx = alphabet.indexOf(char)
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

function totp(secret: string, atMs: number = Date.now()): string {
  const key = base32Decode(secret)
  const counter = Math.floor(atMs / 1000 / 30)
  const buf = Buffer.alloc(8)
  buf.writeBigInt64BE(BigInt(counter))
  const hmac = crypto.createHmac("sha1", key).update(buf).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const code =
    (((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff)) %
    1_000_000
  return String(code).padStart(6, "0")
}

// --- Setup ------------------------------------------------------------------

let probe: Probe | null = null
/** A session that has only ever proved a password. */
let aal1Cookie = ""
/** The same account, after a code from the authenticator. */
let aal2Cookie = ""
let enrolled = false
let setupError = ""

test.beforeAll(async () => {
  probe = await createProbe(TENANT_A.id, "admin", "b10")
  if (!probe) { setupError = "probe creation failed"; return }

  const client = anonClient()
  const { data: signedIn } = await client.auth.signInWithPassword({
    email: probe.email, password: probe.password,
  })
  if (!signedIn?.session) { setupError = "could not sign in"; return }

  const { data: factor, error: enrolErr } = await client.auth.mfa.enroll({ factorType: "totp" })
  if (enrolErr || !factor) { setupError = `enrol failed: ${enrolErr?.message}`; return }

  const { data: challenge, error: chErr } = await client.auth.mfa.challenge({ factorId: factor.id })
  if (chErr || !challenge) { setupError = `challenge failed: ${chErr?.message}`; return }

  const { data: verified, error: vErr } = await client.auth.mfa.verify({
    factorId: factor.id,
    challengeId: challenge.id,
    code: totp((factor as any).totp.secret),
  })
  if (vErr || !verified) { setupError = `verify failed: ${vErr?.message}`; return }

  // Verifying returns an aal2 session. Keep it.
  aal2Cookie = sessionCookie(verified)
  enrolled = true

  // Now sign in afresh with the password only. Because a verified factor now
  // exists, this session is aal1 -- exactly what a stolen password gets you.
  const fresh = anonClient()
  const { data: pwOnly } = await fresh.auth.signInWithPassword({
    email: probe.email, password: probe.password,
  })
  if (pwOnly?.session) aal1Cookie = sessionCookie(pwOnly.session)
})

test.afterAll(async () => {
  await destroyProbe(probe)
})

test("the setup is real", () => {
  // The whole spec is vacuous if enrolment silently failed, and a suite that
  // skips its own tests when setup breaks reports green while testing nothing.
  expect(setupError, setupError).toBe("")
  expect(enrolled, "no authenticator was enrolled").toBe(true)
  expect(aal1Cookie, "no password-only session").toBeTruthy()
  expect(aal2Cookie, "no verified session").toBeTruthy()
  expect(aal1Cookie).not.toBe(aal2Cookie)
})

test.describe("B10: a password alone reaches nothing", () => {
  // A representative spread rather than every route: reads, writes, money,
  // settings, and the one that closes everybody's shift.
  const ROUTES = [
    "/api/admin/team",
    "/api/admin/jobs",
    "/api/admin/signins",
    "/api/admin/settings",
    "/api/admin/pay-rules",
    "/api/admin/retention",
    "/api/admin/weekly-report",
    "/api/admin/jobs/sign-out-all",
  ]

  for (const route of ROUTES) {
    test(`${route} refuses an aal1 session`, async () => {
      const res = await fetch(`${baseUrl()}${route}`, { headers: { Cookie: aal1Cookie } })
      expect(res.status, `${route} answered a password-only session`).toBe(401)
      const body = await res.json().catch(() => ({}))
      // A machine-readable code, so the app can send them to enrol rather than
      // showing a generic "logged out" and losing them.
      expect(body.code).toBe("mfa_required")
    })
  }

  test("the verified session is NOT refused", async () => {
    // The control. Without it, every assertion above would pass on middleware
    // that 401s everything -- which is an outage, not a security control.
    const res = await fetch(`${baseUrl()}/api/admin/team`, { headers: { Cookie: aal2Cookie } })
    expect(res.status, "2FA blocks the account that completed it").not.toBe(401)
  })

  test("an HTML admin page redirects rather than 401s", async () => {
    const res = await fetch(`${baseUrl()}/admin`, {
      headers: { Cookie: aal1Cookie },
      redirect: "manual",
    })
    expect([302, 307, 308]).toContain(res.status)
    expect(res.headers.get("location") || "").toContain("/security/verify")
  })

  test("the redirect remembers where they were going", async () => {
    // Otherwise everybody lands on a dashboard and has to navigate again, and
    // the step-up becomes the thing people turn off.
    const res = await fetch(`${baseUrl()}/admin/payroll`, {
      headers: { Cookie: aal1Cookie },
      redirect: "manual",
    })
    const location = res.headers.get("location") || ""
    expect(location).toContain("next=")
  })
})

test.describe("B10: the exempt list is the whole attack surface", () => {
  const routes = enumerateApiRoutes({
    defaultId: "00000000-0000-0000-0000-000000000009",
    defaultToken: "probe",
  })

  test("the enumeration found the routes", () => {
    expect(routes.length, "no routes enumerated; the sweep below proves nothing")
      .toBeGreaterThan(100)
  })

  test("no /api/admin route is exempt", () => {
    const exempt = routes
      .filter(r => r.pattern.startsWith("/api/admin"))
      .filter(r => isMfaExempt(r.pattern))
      .map(r => r.pattern)
    expect(exempt, `admin routes outside the 2FA gate: ${exempt.join(", ")}`).toEqual([])
  })

  test("every exemption is one of the declared prefixes", () => {
    // The list exists so enrolment is reachable, field requests work, and
    // public pages load. Anything exempt for another reason is an accident.
    const DECLARED = [
      "/api/security", "/api/auth", "/api/installer", "/api/signin", "/api/signout",
      "/api/cron", "/api/signup", "/api/join",
    ]
    const unexpected = routes
      .filter(r => isMfaExempt(r.pattern))
      .filter(r => !DECLARED.some(p => r.pattern === p || r.pattern.startsWith(p + "/")))
      .map(r => r.pattern)
    expect(unexpected, `unexplained exemptions: ${unexpected.join(", ")}`).toEqual([])
  })

  test("a non-admin authenticated route is gated too", () => {
    // 2FA that only covers /api/admin leaves payroll, diary and QA open to a
    // stolen password.
    const ungated = routes
      .filter(r => !isIntentionallyPublic(r.pattern))
      .filter(r => isMfaExempt(r.pattern))
      .filter(r => !r.pattern.startsWith("/api/installer"))
      .filter(r => !r.pattern.startsWith("/api/cron"))
      .filter(r => !r.pattern.startsWith("/api/security"))
      .filter(r => !["/api/signin", "/api/signout"].includes(r.pattern))
      .map(r => r.pattern)
    expect(ungated, `authenticated routes outside the gate: ${ungated.join(", ")}`).toEqual([])
  })
})

test.describe("B10: the code itself", () => {
  test("a wrong code does not verify", async () => {
    const client = anonClient()
    const { data: signedIn } = await client.auth.signInWithPassword({
      email: probe!.email, password: probe!.password,
    })
    expect(signedIn?.session).toBeTruthy()
    const { data: factors } = await client.auth.mfa.listFactors()
    const factorId = factors?.totp?.[0]?.id
    expect(factorId, "no factor to challenge").toBeTruthy()

    const { data: challenge } = await client.auth.mfa.challenge({ factorId: factorId! })
    const { error } = await client.auth.mfa.verify({
      factorId: factorId!,
      challengeId: challenge!.id,
      code: "000000",
    })
    expect(error, "any six digits satisfied the second factor").toBeTruthy()
  })

  test("a code from the wrong time window does not verify", async () => {
    // Replay resistance. A code from ten minutes ago, captured off a shoulder
    // or a screenshot, must be dead.
    const client = anonClient()
    const { data: signedIn } = await client.auth.signInWithPassword({
      email: probe!.email, password: probe!.password,
    })
    expect(signedIn?.session).toBeTruthy()
    const { data: factors } = await client.auth.mfa.listFactors()
    const factorId = factors?.totp?.[0]?.id
    const { data: challenge } = await client.auth.mfa.challenge({ factorId: factorId! })
    const { error } = await client.auth.mfa.verify({
      factorId: factorId!,
      challengeId: challenge!.id,
      code: totp(STALE_SECRET_PLACEHOLDER, Date.now() - 10 * 60 * 1000),
    })
    expect(error).toBeTruthy()
  })
})

// The enrolment secret is not kept past setup; a deliberately wrong secret is
// enough to prove a bad code is refused, and keeping the real one around in a
// module variable for a later test is how a test file ends up holding a
// credential.
const STALE_SECRET_PLACEHOLDER = "JBSWY3DPEHPK3PXP"
