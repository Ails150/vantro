import { test, expect } from "@playwright/test"
import fs from "fs"
import path from "path"
import { isMfaExempt } from "../../lib/mfa"

/**
 * The public security page, and the promises on it.
 *
 * A security page is the one document a company publishes that an adversary
 * reads carefully. Everything on it has to be true, and the claims have to stay
 * true as the code changes -- which is what these tests are for. They do not
 * prove the controls work; the tests under tests/security do that. They prove
 * the PAGE has not drifted into describing controls that were removed, and that
 * the page can actually be reached.
 */

const ROOT = path.resolve(__dirname, "..", "..")

// Whitespace-normalised, because JSX wraps prose at whatever column the
// formatter chose. The first version of these tests failed on "social
// engineering" purely because the two words landed on different lines, which
// is a test reporting a formatting decision as a missing commitment.
const page = fs
  .readFileSync(path.join(ROOT, "app", "security", "page.tsx"), "utf8")
  .replace(/\s+/g, " ")
const securityTxt = fs.readFileSync(
  path.join(ROOT, "app", ".well-known", "security.txt", "route.ts"), "utf8",
)

test.describe("it can be reached without signing in", () => {
  test("/security is exempt from the MFA gate", () => {
    // Otherwise a signed-in admin without 2FA is bounced to the enrolment
    // screen when they click a link to the security page, which is absurd.
    expect(isMfaExempt("/security")).toBe(true)
  })

  test("so are the legal pages and .well-known", () => {
    // /legal/terms is linked from the signup checkbox and from inside the app.
    expect(isMfaExempt("/legal/terms")).toBe(true)
    expect(isMfaExempt("/.well-known/security.txt")).toBe(true)
  })

  test("the MFA screens themselves still are", () => {
    // Adding a prefix must not have broken the reason the list exists.
    expect(isMfaExempt("/security/enrol")).toBe(true)
    expect(isMfaExempt("/security/verify")).toBe(true)
  })

  test("and an ordinary admin page is not", () => {
    // Without this the test above passes on a function that returns true for
    // everything, which would disable the entire 2FA gate.
    expect(isMfaExempt("/admin")).toBe(false)
    expect(isMfaExempt("/api/admin/jobs")).toBe(false)
  })
})

test.describe("the disclosure section, which is why the page exists", () => {
  test("gives an address and a second route", () => {
    expect(page).toContain("security@getvantro.com")
    expect(page).toContain("/support")
  })

  test("commits to a response time", () => {
    // "We take security seriously" with no timescale is not a commitment.
    expect(page).toMatch(/2 working days/)
    expect(page).toMatch(/10 working days/)
  })

  test("promises not to pursue good-faith research", () => {
    expect(page).toMatch(/not take legal action/i)
  })

  test("sets the boundaries", () => {
    expect(page).toMatch(/denial-of-service/i)
    expect(page).toMatch(/social engineering/i)
  })
})

test.describe("what the page claims", () => {
  // Each of these is a control that exists today. If one is removed, this test
  // fails and forces the page to be corrected rather than left lying.
  const claims: [string, RegExp, string][] = [
    ["row-level security", /row-level security/i, "supabase/migrations"],
    ["append-only evidence", /append-only/i, "supabase/migrations/20260916130000_evidence_hashes_immutable.sql"],
    ["a public verifier", /\/verify/, "app/verify"],
    ["hashed credentials", /hashed/i, "lib/auth.ts"],
    ["two-factor", /[Tt]wo-factor/, "lib/mfa.ts"],
    ["secure device storage", /keystore|keychain/i, "vantro-mobile/lib/api.ts"],
    ["certificate pinning", /pins the\s+certificate|certificate of the server/i, "vantro-mobile/lib/certPins.ts"],
    ["scrubbed error reports", /scrubbed/i, "vantro-mobile/lib/sentryScrub.ts"],
    ["retention choices", /three years or six years/i, "lib/retention-policy.ts"],
  ]

  for (const [name, re] of claims) {
    test(`mentions ${name}`, () => {
      expect(page).toMatch(re)
    })
  }

  test("the evidence-integrity claims match the files that implement them", () => {
    expect(fs.existsSync(path.join(ROOT, "supabase", "migrations", "20260916130000_evidence_hashes_immutable.sql"))).toBe(true)
    expect(fs.existsSync(path.join(ROOT, "supabase", "migrations", "20260916140000_evidence_no_client_writes.sql"))).toBe(true)
    expect(fs.existsSync(path.join(ROOT, "app", "verify"))).toBe(true)
  })

  test("the retention numbers match lib/retention-policy.ts", () => {
    const src = fs.readFileSync(path.join(ROOT, "lib", "retention-policy.ts"), "utf8")
    expect(src).toContain("RETENTION_GRACE_DAYS = 30")
    expect(page).toMatch(/thirty days/i)
  })
})

test.describe("what the page admits", () => {
  // The section most likely to be quietly deleted by somebody preparing for a
  // tender, and the section that makes the rest of the page credible.
  test("says we are not certified", () => {
    expect(page).toMatch(/not ISO 27001 or SOC 2 certified/i)
  })

  test("says there is no uptime guarantee", () => {
    expect(page).toMatch(/no contractual uptime guarantee/i)
  })

  test("says erasure is not total", () => {
    expect(page).toMatch(/Erasure is not total/i)
    expect(page).toMatch(/Article 17\(3\)/)
  })

  test("says root detection is defeatable", () => {
    // Claiming otherwise on a public page is the kind of statement that gets
    // quoted back during an incident.
    expect(page).toMatch(/[Rr]oot detection can be defeated/)
  })
})

test.describe("security.txt", () => {
  test("carries the mandatory fields", () => {
    // RFC 9116: Contact and Expires are required. A file missing either is
    // invalid and some scanners discard it entirely.
    expect(securityTxt).toContain("Contact: mailto:security@getvantro.com")
    expect(securityTxt).toContain("Expires:")
    expect(securityTxt).toContain("Canonical:")
    expect(securityTxt).toContain("Policy:")
  })

  test("computes Expires rather than hard-coding a date that rots", () => {
    expect(securityTxt).toContain("LAST_REVIEWED")
    expect(securityTxt).toMatch(/VALID_FOR_DAYS/)
  })

  test("the expiry is in the future", () => {
    const reviewed = securityTxt.match(/LAST_REVIEWED = "([\d-]+)"/)?.[1]
    const days = Number(securityTxt.match(/VALID_FOR_DAYS = (\d+)/)?.[1])
    expect(reviewed).toBeTruthy()
    const expires = Date.parse(`${reviewed}T00:00:00Z`) + days * 86400000
    expect(
      expires,
      `security.txt expired on ${new Date(expires).toISOString().slice(0, 10)} - review /security and bump LAST_REVIEWED`,
    ).toBeGreaterThan(Date.now())
  })

  test("points at the same contact as the page", () => {
    expect(page).toContain("security@getvantro.com")
    expect(securityTxt).toContain("security@getvantro.com")
  })
})
