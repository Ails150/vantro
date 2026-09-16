import { test, expect } from "@playwright/test"
import bcrypt from "bcryptjs"
import { TENANT_A, assertOnlyTestTenants, baseUrl, serviceClient } from "./harness"
import { escapeLikePattern, looksLikePattern } from "../../lib/sql-escape"

/**
 * B7 -- PIN lockout, and the thing found while testing it.
 *
 * The PIN route is carefully built: a per-IP limit, a per-account limit so
 * rotating addresses buys no extra guesses, a lockout after five wrong PINs,
 * one error message whatever went wrong, and a bcrypt comparison against a
 * dummy hash on the unknown-email path so the response time does not answer
 * "does this person have an account".
 *
 * All of that was defeated by one character.
 *
 * `.ilike("email", input)` sends the input as a LIKE PATTERN, not as a value.
 * PostgREST parameterises everything, so no quote ever escapes and this is not
 * SQL injection -- which is why it survived a read-through. But in a LIKE
 * pattern `%` means "anything". A sign-in carrying the email
 *
 *     security-b7-probe-%@vantro.test
 *
 * came back 200 from production with a working ninety-day field token for an
 * account whose address the caller never knew. The email was never a filter;
 * it was a search.
 *
 * Five routes took request input into ilike(): sign-in, the check-only branch,
 * setup-pin, reset-pin, and the admin password reset. setup-pin is the worst of
 * them -- it sets a PIN on any account that does not yet have one, so a pattern
 * narrowing to one PIN-less installer is a complete account takeover without
 * ever knowing who they are.
 */

const PIN = "1234"
const WRONG = "9999"
let email = ""
let userId = ""
let prefix = ""

test.beforeAll(async () => {
  assertOnlyTestTenants(TENANT_A.id)
  prefix = `security-b7-${Date.now()}-${Math.floor(Math.random() * 1e4)}`
  email = `${prefix}@vantro.test`
  const service = serviceClient()
  const { data, error } = await service
    .from("users")
    .insert({
      company_id: TENANT_A.id,
      email,
      name: "[TEST] b7",
      initials: "TB",
      role: "installer",
      is_active: true,
      pin_hash: await bcrypt.hash(PIN, 10),
    })
    .select("id")
    .single()
  if (error || !data) throw new Error(`b7 setup failed: ${error?.message}`)
  userId = (data as any).id
})

test.afterAll(async () => {
  if (email) await serviceClient().from("users").delete().eq("email", email)
})

/** Reset the account between tests so each starts from a known state. */
async function unlock() {
  await serviceClient()
    .from("users")
    .update({ pin_attempts: 0, pin_locked_until: null })
    .eq("id", userId)
}

async function signIn(body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl()}/api/installer/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

test("the setup is real", async () => {
  expect(userId, "no test installer; every assertion below would be vacuous").toBeTruthy()
  await unlock()
  const ok = await signIn({ email, pin: PIN })
  expect(ok.status, "the correct PIN does not work, so nothing below means anything").toBe(200)
  expect(ok.body.token).toBeTruthy()
})

test.describe("the escaper itself", () => {
  test("neutralises every LIKE metacharacter", () => {
    expect(escapeLikePattern("a%b")).toBe("a\\%b")
    expect(escapeLikePattern("a_b")).toBe("a\\_b")
    // The backslash has to go first, or escaping the wildcards double-escapes
    // anything that already contained one.
    expect(escapeLikePattern("a\\b")).toBe("a\\\\b")
    expect(escapeLikePattern("a\\%b")).toBe("a\\\\\\%b")
  })

  test("leaves a real address alone", () => {
    // If it mangled ordinary addresses, every installer would be locked out and
    // the fix would be worse than the bug.
    for (const addr of ["marcus@holts.co.uk", "a.b-c+d@sub.example.com", "O'Brien@x.com"]) {
      expect(escapeLikePattern(addr)).toBe(addr)
    }
  })

  test("survives null and undefined", () => {
    expect(escapeLikePattern(undefined as any)).toBe("")
    expect(escapeLikePattern(null as any)).toBe("")
  })

  test("looksLikePattern spots the probe", () => {
    expect(looksLikePattern("%@holts.co.uk")).toBe(true)
    expect(looksLikePattern("marcus@holts.co.uk")).toBe(false)
  })
})

test.describe("B7: a wildcard is not an email address", () => {
  // Each of these was a working attack before the fix. They are written as
  // patterns that single out THIS test's own account, so nothing here can touch
  // a real user even if the fix were reverted.

  test("sign-in refuses a pattern that would match a real account", async () => {
    await unlock()
    const attack = await signIn({ email: `${prefix.slice(0, -4)}%@vantro.test`, pin: PIN })
    expect(
      attack.status,
      `a LIKE pattern authenticated: ${JSON.stringify(attack.body).slice(0, 160)}`,
    ).not.toBe(200)
    expect(attack.body.token, "a token was issued to a pattern").toBeUndefined()
  })

  test("a bare % authenticates nobody", async () => {
    await unlock()
    const attack = await signIn({ email: "%", pin: PIN })
    expect(attack.status).not.toBe(200)
    expect(attack.body.token).toBeUndefined()
  })

  test("an underscore is not a single-character wildcard either", async () => {
    await unlock()
    // `_` matches exactly one character, so this is the same attack with a
    // narrower net -- and the one people forget when they only escape `%`.
    const attack = await signIn({ email: email.replace("@", "_"), pin: PIN })
    expect(attack.status).not.toBe(200)
  })

  test("check-only does not answer a pattern", async () => {
    const attack = await signIn({ checkOnly: true, email: `${prefix.slice(0, -4)}%@vantro.test` })
    expect(attack.body.exists, "a pattern confirmed an account exists").not.toBe(true)
  })

  test("setup-pin refuses a pattern", async () => {
    // The worst of the five. It sets a PIN on any account without one, so a
    // pattern narrowing to a single PIN-less installer is a takeover.
    const res = await fetch(`${baseUrl()}/api/installer/setup-pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `${prefix.slice(0, -4)}%@vantro.test`, pin: "4321" }),
    })
    expect(res.status, "a pattern reached setup-pin").not.toBe(200)
  })

  test("reset-pin refuses a pattern", async () => {
    const res = await fetch(`${baseUrl()}/api/installer/reset-pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `${prefix.slice(0, -4)}%@vantro.test` }),
    })
    const body = await res.json().catch(() => ({}))
    // These routes answer uniformly by design, so the assertion is that no
    // reset email was actually sent for a pattern -- visible as the PIN reset
    // token NOT being set on the account.
    expect(body.token).toBeUndefined()
    const { data } = await serviceClient()
      .from("users").select("pin_reset_token").eq("id", userId).maybeSingle()
    expect(
      (data as any)?.pin_reset_token,
      "a pattern triggered a PIN reset on a real account",
    ).toBeFalsy()
  })

  test("no route puts raw request input into ilike any more", () => {
    // The durable half. A sixth route added next month with .ilike('email',
    // body.email) re-opens all of this, and nothing else would notice.
    const fs = require("fs") as typeof import("fs")
    const path = require("path") as typeof import("path")
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (["node_modules", ".next", ".git"].includes(entry.name)) continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) { walk(full); continue }
        if (!/\.tsx?$/.test(entry.name)) continue
        const src = fs.readFileSync(full, "utf8")
        for (const m of src.matchAll(/\.i?like\(\s*['"][^'"]+['"]\s*,\s*([^)]+)\)/g)) {
          const arg = m[1].trim()
          if (arg.includes("escapeLikePattern")) continue
          // A literal pattern written by us is fine; input is not.
          if (/^['"`]/.test(arg)) continue
          offenders.push(`${path.relative(process.cwd(), full)}: .ilike(..., ${arg.slice(0, 60)})`)
        }
      }
    }
    for (const root of ["app", "lib"]) walk(path.join(process.cwd(), root))
    expect(offenders, offenders.join("; ")).toEqual([])
  })
})

test.describe("B7: the lockout", () => {
  test("five wrong PINs lock the account", async () => {
    await unlock()
    for (let i = 0; i < 5; i++) {
      const r = await signIn({ email, pin: WRONG })
      expect(r.status, `attempt ${i + 1} should be refused`).toBe(401)
    }

    // The proof: the CORRECT PIN is now refused too. Without this the test only
    // shows that wrong PINs are rejected, which they would be anyway.
    const correct = await signIn({ email, pin: PIN })
    expect(
      correct.status,
      "the correct PIN still worked after five failures; the lockout does nothing",
    ).toBe(401)

    const { data } = await serviceClient()
      .from("users").select("pin_locked_until").eq("id", userId).maybeSingle()
    expect((data as any)?.pin_locked_until, "no lockout was recorded").toBeTruthy()
    const until = Date.parse((data as any).pin_locked_until)
    expect(until).toBeGreaterThan(Date.now())
    // Fifteen minutes in the product. Long enough to make 10,000 guesses take
    // years, short enough that a worker who fat-fingered it is not stranded.
    expect((until - Date.now()) / 60000).toBeLessThanOrEqual(16)
  })

  test("the lockout clears, and a good PIN works again", async () => {
    await unlock()
    const ok = await signIn({ email, pin: PIN })
    expect(ok.status, "clearing the lockout did not restore access").toBe(200)
  })

  test("a successful sign-in resets the counter", async () => {
    await unlock()
    await signIn({ email, pin: WRONG })
    await signIn({ email, pin: WRONG })
    await signIn({ email, pin: PIN })
    const { data } = await serviceClient()
      .from("users").select("pin_attempts, pin_locked_until").eq("id", userId).maybeSingle()
    // Otherwise three more mistakes over the following weeks lock somebody out
    // for reasons they cannot possibly connect.
    expect((data as any)?.pin_attempts).toBe(0)
    expect((data as any)?.pin_locked_until).toBeNull()
  })
})

test.describe("B7: what a failure discloses", () => {
  test("an unknown address and a wrong PIN are indistinguishable", async () => {
    await unlock()
    const unknown = await signIn({ email: `nobody-${Date.now()}@vantro.test`, pin: PIN })
    const wrong = await signIn({ email, pin: WRONG })
    expect(unknown.status).toBe(wrong.status)
    expect(JSON.stringify(unknown.body)).toBe(JSON.stringify(wrong.body))
  })

  test("a short PIN is refused before anything is looked up", async () => {
    const r = await signIn({ email, pin: "12" })
    expect(r.status).toBe(400)
  })

  test("check-only is rate limited per address", async () => {
    // It still answers "does this account exist", which cannot be closed on the
    // server without a mobile change -- the app uses it to choose between
    // "enter your PIN" and "set one up". What it must not allow is sweeping a
    // list: each address now costs the same budget as a sign-in attempt.
    const target = `sweep-${Date.now()}@vantro.test`
    const codes: number[] = []
    for (let i = 0; i < 7; i++) {
      codes.push((await signIn({ checkOnly: true, email: target })).status)
    }
    expect(codes, `check-only never rate limited: ${codes.join(",")}`).toContain(429)
  })
})
