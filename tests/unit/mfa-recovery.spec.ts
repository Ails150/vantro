import { test, expect } from "@playwright/test"
import {
  RECOVERY_CODE_COUNT,
  generateRecoveryCode,
  generateRecoveryCodes,
  looksLikeRecoveryCode,
  normaliseRecoveryCode,
} from "../../lib/mfa-recovery"

/**
 * A recovery code is read off a photograph, or a bit of paper in a van, by
 * somebody who has just lost their phone. Every rule here exists to stop it
 * failing at that moment.
 */

test.describe("generation", () => {
  test("ten codes, in the documented shape", () => {
    const codes = generateRecoveryCodes()
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT)
    expect(RECOVERY_CODE_COUNT).toBe(10)
    for (const c of codes) expect(c).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/)
  })

  test("no ambiguous characters, ever", () => {
    // I, L, O and U are unreadable next to 1 and 0 on paper.
    const all = generateRecoveryCodes(200).join("")
    for (const bad of ["I", "L", "O", "U"]) expect(all).not.toContain(bad)
  })

  test("a set never contains a duplicate", () => {
    // Two identical codes would both stop working when one was redeemed.
    for (let i = 0; i < 20; i++) {
      const codes = generateRecoveryCodes()
      expect(new Set(codes).size).toBe(codes.length)
    }
  })

  test("codes differ between sets", () => {
    expect(generateRecoveryCodes().join()).not.toBe(generateRecoveryCodes().join())
  })

  test("the alphabet is actually used across its range", () => {
    // A generator stuck on a subset would pass every other test here.
    const seen = new Set(generateRecoveryCodes(500).join("").split(""))
    expect(seen.size).toBeGreaterThan(25)
  })

  test("a single code is the right length", () => {
    expect(generateRecoveryCode().replace("-", "")).toHaveLength(10)
  })
})

test.describe("normalising what somebody actually types", () => {
  const CODE = "7K2M9-QXR4T"

  test("the code itself is unchanged", () => {
    expect(normaliseRecoveryCode(CODE)).toBe(CODE)
  })

  test("lower case is accepted", () => {
    expect(normaliseRecoveryCode("7k2m9-qxr4t")).toBe(CODE)
  })

  test("a missing hyphen is accepted", () => {
    expect(normaliseRecoveryCode("7K2M9QXR4T")).toBe(CODE)
  })

  test("spaces and stray punctuation are accepted", () => {
    expect(normaliseRecoveryCode("  7K2M9 QXR4T  ")).toBe(CODE)
    expect(normaliseRecoveryCode("7K2M9 — QXR4T")).toBe(CODE)
  })

  test("a letter read for a digit is CORRECTED, not refused", () => {
    // O cannot occur in a real code, so an O means somebody read a zero as a
    // letter. That is the exact error this alphabet exists to avoid, and
    // fixing it beats refusing it.
    expect(normaliseRecoveryCode("O1234-5678O")).toBe("01234-56780")
    expect(normaliseRecoveryCode("I1234-5678L")).toBe("11234-56781")
    expect(normaliseRecoveryCode("oil34-56789")).toBe("01134-56789")
  })

  test("the wrong length comes back unpadded so the caller can refuse it", () => {
    expect(looksLikeRecoveryCode("7K2M9")).toBe(false)
    expect(looksLikeRecoveryCode("7K2M9-QXR4T-EXTRA")).toBe(false)
  })

  test("empty and rubbish are refused rather than throwing", () => {
    for (const bad of ["", null, undefined, "!!!!!", "          "]) {
      expect(() => normaliseRecoveryCode(bad as any)).not.toThrow()
      expect(looksLikeRecoveryCode(bad as any)).toBe(false)
    }
  })
})

test.describe("looksLikeRecoveryCode", () => {
  test("accepts every generated code, in any casing or spacing", () => {
    for (const code of generateRecoveryCodes(50)) {
      expect(looksLikeRecoveryCode(code)).toBe(true)
      expect(looksLikeRecoveryCode(code.toLowerCase())).toBe(true)
      expect(looksLikeRecoveryCode(code.replace("-", ""))).toBe(true)
      expect(looksLikeRecoveryCode(` ${code} `)).toBe(true)
    }
  })

  test("rejects a TOTP code, which is what people will paste by mistake", () => {
    expect(looksLikeRecoveryCode("123456")).toBe(false)
  })
})
