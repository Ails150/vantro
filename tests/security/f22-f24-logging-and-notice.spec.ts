import { test, expect } from "@playwright/test"
import fs from "fs"
import path from "path"
import {
  REDACTED, scrubBreadcrumb, scrubEvent, scrubHeaders, scrubString, scrubUrl, scrubValue,
} from "../../lib/sentry-scrub"

/**
 * F22 -- what leaves the process when something goes wrong.
 * F24 -- whether a change to how an account is reached is announced.
 *
 * F22 WAS A FINDING, and the same one as the mobile app. All three web Sentry
 * configs -- server, edge and client -- shipped with `sendDefaultPii: true`,
 * the setting that sends request headers. On this product that means:
 *
 *   - The COOKIE header on every admin request, carrying
 *     sb-<ref>-auth-token: a complete, working Supabase session. Anybody with
 *     read access to the error tracker could sign in as that administrator.
 *   - The AUTHORIZATION header on every field request, carrying a bearer token
 *     good for ninety days against a company's real site data.
 *
 * tracesSampleRate was 1, so it was not limited to crashes: every request made
 * a transaction and every transaction carried the headers. The edge config is
 * the worst of the three, because it initialises Sentry for MIDDLEWARE, which
 * runs on every request in the product.
 *
 * WHAT THIS SPEC CANNOT DO, stated rather than glossed: it cannot watch what
 * Sentry actually ingests. That needs a Sentry API token this suite does not
 * have. What it does instead is drive the scrubber with the exact payload
 * shapes the SDK produces, and assert the configs still call it -- the two
 * halves that can fail independently.
 */

const ROOT = process.cwd()

// A JWT shaped like a real one, signed with nothing.
const TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
  ".eyJ1c2VySWQiOiJhYmMiLCJjb21wYW55SWQiOiJkZWYifQ" +
  ".c2lnbmF0dXJlLWdvZXMtaGVyZQ"

const SESSION_COOKIE = `sb-lmobuqxmtkctqqwbspoz-auth-token=base64-eyJhY2Nlc3NfdG9rZW4iOiJ4In0; other=1`

test.describe("F22: the scrubber", () => {
  test("removes a JWT wherever it appears", () => {
    expect(scrubString(TOKEN)).toBe(REDACTED)
    const line = `request failed with ${TOKEN} at 09:04`
    expect(scrubString(line)).not.toContain("eyJ")
    // And keeps everything that made the report worth having.
    expect(scrubString(line)).toContain("09:04")
  })

  test("removes a bearer value but keeps the scheme", () => {
    const out = scrubString(`Bearer ${TOKEN}`)
    expect(out).toContain("Bearer")
    expect(out).not.toContain("eyJ")
  })

  test("removes a Supabase session cookie", () => {
    // THE ONE THAT MATTERS. This is a signed-in administrator, in a string.
    const out = scrubString(SESSION_COOKIE)
    expect(out).not.toContain("base64-")
    expect(out).toContain(REDACTED)
  })

  test("leaves ordinary text alone", () => {
    const msg = "Sign in failed: the site is out of range"
    expect(scrubString(msg)).toBe(msg)
  })

  test("headers: every credential-bearing one goes, the useful ones stay", () => {
    const out = scrubHeaders({
      Authorization: `Bearer ${TOKEN}`,
      Cookie: SESSION_COOKIE,
      "X-Api-Key": "secret",
      "stripe-signature": "t=1,v1=abc",
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0",
    })!
    expect(out.Authorization).toBe(REDACTED)
    expect(out.Cookie).toBe(REDACTED)
    expect(out["X-Api-Key"]).toBe(REDACTED)
    expect(out["stripe-signature"]).toBe(REDACTED)
    // A report with no content type or user agent is a report nobody can use.
    expect(out["Content-Type"]).toBe("application/json")
    expect(out["User-Agent"]).toBe("Mozilla/5.0")
  })

  test("headers: casing does not matter", () => {
    expect(scrubHeaders({ authorization: `Bearer ${TOKEN}` })!.authorization).toBe(REDACTED)
    expect(scrubHeaders({ COOKIE: SESSION_COOKIE })!.COOKIE).toBe(REDACTED)
  })

  test("values: redacts by key name", () => {
    expect(scrubValue({ pin: "4821" })).toEqual({ pin: REDACTED })
    expect(scrubValue({ password: "hunter2" })).toEqual({ password: REDACTED })
    expect(scrubValue({ service_role_key: "x" })).toEqual({ service_role_key: REDACTED })
  })

  test("values: redacts location", () => {
    // Not an afterthought. A workforce product that leaks where somebody was
    // standing has failed at the one thing its users did not choose to share.
    const out = scrubValue({ lat: 51.5074, lng: -0.1278, jobName: "Eddington" }) as any
    expect(out.lat).toBe(REDACTED)
    expect(out.lng).toBe(REDACTED)
    expect(out.jobName).toBe("Eddington")
  })

  test("values: redacts a token found under an innocent key", () => {
    const out = scrubValue({ detail: `failed: Bearer ${TOKEN}` }) as any
    expect(out.detail).not.toContain("eyJ")
  })

  test("values: walks arrays and nesting, and stops rather than hanging", () => {
    const out = scrubValue([{ token: TOKEN }, { ok: 1 }]) as any[]
    expect(out[0].token).toBe(REDACTED)
    expect(out[1].ok).toBe(1)

    let deep: any = { v: 1 }
    for (let i = 0; i < 60; i++) deep = { nested: deep }
    expect(() => scrubValue(deep)).not.toThrow()
  })

  test("urls: a token in the query string goes", () => {
    // Magic-link callbacks put a token_hash in the URL, and the URL is on every
    // event as request.url.
    const out = scrubUrl("https://app.getvantro.com/auth/callback?token_hash=abc123&type=magiclink")!
    expect(out).not.toContain("abc123")
    expect(out).toContain("type=magiclink")
  })

  test("urls: userinfo goes too", () => {
    const out = scrubUrl("https://user:pass@app.getvantro.com/admin")!
    expect(out).not.toContain("pass")
  })
})

test.describe("F22: a whole event", () => {
  test("the Authorization header is stripped off a request", () => {
    const event = scrubEvent({
      request: {
        url: "https://app.getvantro.com/api/installer/jobs",
        headers: { Authorization: `Bearer ${TOKEN}`, Cookie: SESSION_COOKIE },
      },
    })
    expect(event.request.headers.Authorization).toBe(REDACTED)
    expect(event.request.headers.Cookie).toBe(REDACTED)
  })

  test("the user is reduced to an id", () => {
    const event = scrubEvent({
      user: { id: "u1", email: "admin@holts.co.uk", ip_address: "1.2.3.4", username: "admin" },
    })
    expect(event.user).toEqual({ id: "u1" })
  })

  test("breadcrumbs are scrubbed, which is where fetch logs headers", () => {
    const event = scrubEvent({
      breadcrumbs: [{ category: "fetch", data: { url: "/api/jobs", token: TOKEN } }],
    })
    expect(event.breadcrumbs[0].data.token).toBe(REDACTED)
  })

  test("an exception message carrying a token is scrubbed", () => {
    const event = scrubEvent({
      exception: { values: [{ type: "Error", value: `401 for Bearer ${TOKEN}` }] },
    })
    expect(event.exception.values[0].value).not.toContain("eyJ")
  })

  test("it survives an empty or partial event", () => {
    expect(() => scrubEvent({})).not.toThrow()
    expect(scrubEvent(null)).toBeNull()
    expect(() => scrubEvent({ request: {} })).not.toThrow()
  })

  test("if it cannot scrub, it drops the event", () => {
    // The opposite of the usual fail-open, and deliberate: a lost error report
    // costs a debugging session, a leaked session cookie costs a customer.
    const hostile = { get request() { throw new Error("no") } }
    expect(scrubEvent(hostile)).toBeNull()
  })

  test("a breadcrumb is cleaned in both message and data", () => {
    const out = scrubBreadcrumb({
      message: `calling with Bearer ${TOKEN}`,
      data: { pin: "4821", lat: 51.5 },
    })
    expect(out.message).not.toContain("eyJ")
    expect(out.data.pin).toBe(REDACTED)
    expect(out.data.lat).toBe(REDACTED)
  })
})

test.describe("F22: every config is wired", () => {
  const CONFIGS = ["sentry.server.config.ts", "sentry.edge.config.ts", "instrumentation-client.ts"]

  test("all three exist", () => {
    // Without this the loop below passes on an empty list, and the edge config
    // -- the one that covers middleware, which runs on every request -- is
    // exactly the one somebody forgets.
    for (const file of CONFIGS) {
      expect(fs.existsSync(path.join(ROOT, file)), `${file} is missing`).toBe(true)
    }
  })

  for (const file of CONFIGS) {
    test(`${file}: PII is off and the scrubber is called`, () => {
      const src = fs.readFileSync(path.join(ROOT, file), "utf8")
      expect(src).toMatch(/sendDefaultPii:\s*false/)
      expect(src, "sendDefaultPii is true somewhere in this file").not.toMatch(/sendDefaultPii:\s*true/)
      expect(src).toMatch(/beforeSend:\s*scrubEvent/)
      expect(src).toMatch(/beforeBreadcrumb:\s*scrubBreadcrumb/)
    })
  }

  test("session replay masks text, inputs and media", () => {
    // It records 10% of sessions and 100% with an error, on screens showing
    // worker names, hourly rates and the place somebody stood. The SDK's
    // defaults do mask text; relying on a default for that is how a version
    // bump becomes a disclosure.
    const src = fs.readFileSync(path.join(ROOT, "instrumentation-client.ts"), "utf8")
    expect(src).toMatch(/maskAllText:\s*true/)
    expect(src).toMatch(/maskAllInputs:\s*true/)
    expect(src).toMatch(/blockAllMedia:\s*true/)
  })

  test("no config anywhere turns PII back on", () => {
    // The scrubber's own documentation and this spec both quote the setting in
    // order to explain what it did. A scanner that flags the fix for describing
    // the bug is one somebody disables, so they are named here rather than
    // having their comments reworded to dodge a regex.
    const EXPLAINS_THE_BUG = [
      path.join("lib", "sentry-scrub.ts"),
      path.join("tests", "security", "f22-f24-logging-and-notice.spec.ts"),
    ]
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (["node_modules", ".next", ".git", "test-results"].includes(entry.name)) continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) { walk(full); continue }
        if (!/\.tsx?$/.test(entry.name)) continue
        if (EXPLAINS_THE_BUG.some(f => full.endsWith(f))) continue
        const src = fs.readFileSync(full, "utf8")
        if (/sendDefaultPii:\s*true/.test(src)) offenders.push(path.relative(ROOT, full))
      }
    }
    walk(ROOT)
    expect(offenders, offenders.join(", ")).toEqual([])
  })
})

test.describe("F22: nothing logs a credential on purpose", () => {
  test("no console call prints a token, PIN or password value", () => {
    // Logging that a token is ABSENT is useful. Logging the value is not. This
    // looks for a bare identifier being passed, not the word inside a string.
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (["node_modules", ".next", ".git", "tests", "test-results"].includes(entry.name)) continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) { walk(full); continue }
        if (!/\.tsx?$/.test(entry.name)) continue
        const src = fs.readFileSync(full, "utf8")
        for (const m of src.matchAll(/console\.(log|warn|error|info|debug)\(([^)]*)\)/g)) {
          const args = m[2].replace(/(['"`])(?:\\.|(?!\1).)*\1/g, "")
          if (/(^|[,\s(])(token|pin|jwt|password|secret|pin_hash)\b(?![\w'"])/.test(args)) {
            offenders.push(`${path.relative(ROOT, full)}: console.${m[1]}(${m[2].slice(0, 50)})`)
          }
        }
      }
    }
    for (const root of ["app", "lib"]) walk(path.join(ROOT, root))
    expect(offenders, offenders.join("; ")).toEqual([])
  })
})

test.describe("F24: a change to how an account is reached", () => {
  // THE HONEST ANSWER: there is no email-change feature to test.
  //
  // /api/admin/account changes a display name and nothing else, and nothing in
  // the codebase calls auth.admin.updateUserById or auth.updateUser with an
  // email. An account's address is set at signup or by invite and never
  // changes.
  //
  // So F24 cannot fail today. What it CAN do is fail the day somebody adds the
  // feature without the notice, which is the only useful thing a test can do
  // about a control for a feature that does not exist.

  test("the account route changes a name and nothing else", () => {
    const src = fs.readFileSync(path.join(ROOT, "app", "api", "admin", "account", "route.ts"), "utf8")
    expect(src).toMatch(/\.update\(\{\s*name,\s*initials/)
    expect(src, "the account route now touches email; F24 needs a real test")
      .not.toMatch(/email\s*[,:]/)
  })

  test("nothing changes an auth email without telling the old address", () => {
    // If this fails, an email-change feature has appeared. The rule it is
    // guarding is simple and not optional: changing the address on an account
    // is how an account is stolen quietly, so the OLD address has to be told,
    // and told by something other than the code doing the changing.
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (["node_modules", ".next", ".git", "test-results"].includes(entry.name)) continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) { walk(full); continue }
        if (!/\.tsx?$/.test(entry.name)) continue
        const src = fs.readFileSync(full, "utf8")
        if (!/updateUserById\(|auth\.updateUser\(/.test(src)) continue
        // A password change is fine: the person already had to prove they hold
        // the address to get the link that let them set it.
        if (/email\s*:/.test(src) && !/notif|sendEmail|resend|alert/i.test(src)) {
          offenders.push(path.relative(ROOT, full))
        }
      }
    }
    for (const root of ["app", "lib"]) walk(path.join(ROOT, root))
    expect(
      offenders,
      `an email change with no notice to the old address: ${offenders.join(", ")}`,
    ).toEqual([])
  })

  test("a password change is reachable only by proving you hold the address", () => {
    // The adjacent control that DOES exist. Both password screens work off a
    // session established by a link Supabase emailed, so the account owner is
    // in the loop by construction rather than by a notification.
    for (const page of ["app/reset-password/page.tsx", "app/set-password/page.tsx"]) {
      const src = fs.readFileSync(path.join(ROOT, page), "utf8")
      expect(src).toMatch(/auth\.updateUser\(\{\s*password/)
      // No route accepts a password change for an arbitrary user id.
      expect(src).not.toMatch(/updateUserById/)
    }
  })
})
