import { test, expect } from "@playwright/test"
import {
  assuranceLevelFromToken,
  hasVerifiedFactor,
  isMfaExempt,
  mfaOutcome,
  mfaRequiredFor,
} from "../../lib/mfa"

/**
 * This is the code that can lock every administrator out of the product,
 * including the only superadmin. It gets a table of cases, not a reading.
 */

const state = (currentLevel: any, hasVerifiedFactor: boolean) => ({ currentLevel, hasVerifiedFactor })

test.describe("mfaOutcome: the whole policy", () => {
  test("an admin with no factor is let through — it is optional for them", () => {
    expect(mfaOutcome("admin", state("aal1", false))).toBe("ok")
  })

  test("an admin WITH a factor must use it", () => {
    // Optional to enrol; having enrolled, not optional to use. A second factor
    // that can be skipped by ignoring the prompt is decoration.
    expect(mfaOutcome("admin", state("aal1", true))).toBe("must_verify")
  })

  test("an admin who has already stepped up is done", () => {
    expect(mfaOutcome("admin", state("aal2", true))).toBe("ok")
  })

  test("a superadmin with no factor must enrol", () => {
    expect(mfaOutcome("superadmin", state("aal1", false))).toBe("must_enrol")
  })

  test("a superadmin with a factor must verify", () => {
    expect(mfaOutcome("superadmin", state("aal1", true))).toBe("must_verify")
  })

  test("a superadmin at aal2 is done", () => {
    expect(mfaOutcome("superadmin", state("aal2", true))).toBe("ok")
  })

  test("support is held to the superadmin standard", () => {
    // Support can switch into any tenant, so the blast radius is the same.
    expect(mfaOutcome("support", state("aal1", false))).toBe("must_enrol")
    expect(mfaOutcome("support", state("aal1", true))).toBe("must_verify")
    expect(mfaOutcome("support", state("aal2", true))).toBe("ok")
  })

  test("field roles are untouched", () => {
    // They authenticate with a PIN and a field token and hold no Supabase
    // session at all, so there is nothing here to enforce.
    for (const role of ["installer", "foreman", "worker", "cleaner"]) {
      expect(mfaOutcome(role, state("aal1", false))).toBe("ok")
      expect(mfaOutcome(role, state(null, false))).toBe("ok")
    }
  })

  test("an unknown or missing role degrades to today's behaviour", () => {
    // A mis-set role must not lock somebody out.
    for (const role of [null, undefined, "", "nonsense"]) {
      expect(mfaOutcome(role, state("aal1", false))).toBe("ok")
    }
  })

  test("aal2 always wins, whatever the role", () => {
    for (const role of ["admin", "superadmin", "support", "installer", "nonsense"]) {
      expect(mfaOutcome(role, state("aal2", false))).toBe("ok")
      expect(mfaOutcome(role, state("aal2", true))).toBe("ok")
    }
  })
})

test.describe("mfaRequiredFor", () => {
  test("mandatory for the roles that can reach every tenant", () => {
    expect(mfaRequiredFor("superadmin")).toBe(true)
    expect(mfaRequiredFor("support")).toBe(true)
  })
  test("optional for an ordinary admin", () => {
    expect(mfaRequiredFor("admin")).toBe(false)
    expect(mfaRequiredFor("installer")).toBe(false)
    expect(mfaRequiredFor(null)).toBe(false)
  })
})

test.describe("isMfaExempt: the list that stops enforcement being a trap", () => {
  test("the enrolment and verify screens are reachable", () => {
    // Without this a superadmin with no factor is redirected to enrolment,
    // which redirects to enrolment.
    expect(isMfaExempt("/security")).toBe(true)
    expect(isMfaExempt("/security/enrol")).toBe(true)
    expect(isMfaExempt("/api/security/enrol")).toBe(true)
  })

  test("somebody who cannot finish enrolment can still leave", () => {
    expect(isMfaExempt("/login")).toBe(true)
    expect(isMfaExempt("/api/auth/signout")).toBe(true)
  })

  test("the field app is untouched", () => {
    expect(isMfaExempt("/installer")).toBe(true)
    expect(isMfaExempt("/installer/jobs")).toBe(true)
    expect(isMfaExempt("/api/installer/rams")).toBe(true)
    expect(isMfaExempt("/api/signin")).toBe(true)
  })

  test("cron carries a secret, not a session", () => {
    expect(isMfaExempt("/api/cron/weekly-report")).toBe(true)
  })

  test("the public evidence verifier stays public", () => {
    expect(isMfaExempt("/verify")).toBe(true)
    expect(isMfaExempt("/verify/VNT-7K2M")).toBe(true)
  })

  test("the admin surface is NOT exempt", () => {
    expect(isMfaExempt("/admin")).toBe(false)
    expect(isMfaExempt("/admin/setup")).toBe(false)
    expect(isMfaExempt("/api/admin/team")).toBe(false)
    expect(isMfaExempt("/api/payroll")).toBe(false)
    expect(isMfaExempt("/billing")).toBe(false)
  })

  test("a prefix must not match a different path that merely starts with it", () => {
    // "/logins-report" is not "/login".
    expect(isMfaExempt("/logins-report")).toBe(false)
    expect(isMfaExempt("/securityaudit")).toBe(false)
    expect(isMfaExempt("/verifying")).toBe(false)
  })

  test("the root is exempt", () => {
    expect(isMfaExempt("/")).toBe(true)
  })
})

test.describe("assuranceLevelFromToken", () => {
  const tokenWith = (payload: any) => {
    const b64 = (o: any) =>
      Buffer.from(JSON.stringify(o)).toString("base64")
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
    return `${b64({ alg: "HS256" })}.${b64(payload)}.signature`
  }

  test("reads aal1 and aal2", () => {
    expect(assuranceLevelFromToken(tokenWith({ aal: "aal1" }))).toBe("aal1")
    expect(assuranceLevelFromToken(tokenWith({ aal: "aal2" }))).toBe("aal2")
  })

  test("a claim that is missing or unexpected is null, not a guess", () => {
    expect(assuranceLevelFromToken(tokenWith({}))).toBeNull()
    expect(assuranceLevelFromToken(tokenWith({ aal: "aal3" }))).toBeNull()
    expect(assuranceLevelFromToken(tokenWith({ aal: null }))).toBeNull()
  })

  test("garbage is null rather than a throw", () => {
    for (const bad of ["", null, undefined, "not.a.token", "onlyonepart", "a.b", "a.b.c.d"]) {
      expect(() => assuranceLevelFromToken(bad as any)).not.toThrow()
      expect(assuranceLevelFromToken(bad as any)).toBeNull()
    }
  })

  test("a payload carrying an accented name still parses", () => {
    // atob returns latin1; without re-decoding as UTF-8 this corrupts and the
    // JSON parse throws, which would read as "cannot tell" for every admin
    // whose name has an accent in it.
    const t = tokenWith({ aal: "aal2", user_metadata: { name: "Paweł Ślusarz" } })
    expect(assuranceLevelFromToken(t)).toBe("aal2")
  })
})

test.describe("hasVerifiedFactor", () => {
  test("a verified factor counts", () => {
    expect(hasVerifiedFactor({ factors: [{ status: "verified" }] })).toBe(true)
  })

  test("an abandoned enrolment does NOT count", () => {
    // Somebody who opened the QR code and closed the tab must not be locked out
    // by a factor they cannot produce a code for.
    expect(hasVerifiedFactor({ factors: [{ status: "unverified" }] })).toBe(false)
  })

  test("a mix counts if any one is verified", () => {
    expect(hasVerifiedFactor({ factors: [{ status: "unverified" }, { status: "verified" }] })).toBe(true)
  })

  test("no factors, or a malformed user, is false rather than a throw", () => {
    for (const u of [{}, { factors: [] }, { factors: null }, null, undefined, { factors: "nope" }]) {
      expect(() => hasVerifiedFactor(u)).not.toThrow()
      expect(hasVerifiedFactor(u)).toBe(false)
    }
  })
})
