// lib/mfa-recovery.ts
//
// Generating, formatting and checking two-factor recovery codes.
//
// The generation and comparison rules are here, away from the routes, because
// they are the part worth testing: an alphabet that produces ambiguous
// characters, or a comparison that is case sensitive, turns a recovery code
// into a code that does not work at the exact moment somebody needs it most.

import crypto from "crypto"

/** Ten, which is the number people expect and enough to survive a few losses. */
export const RECOVERY_CODE_COUNT = 10

/**
 * Crockford base32 minus the ambiguous letters.
 *
 * No I, L, O or U. The first three are unreadable next to 1 and 0 in most
 * fonts, and these codes get written on paper, photographed, and read back over
 * a phone under pressure. U is dropped because Crockford drops it, which keeps
 * this alphabet identical to the one audit pack references already use --
 * somebody transcribing either has the same rules in their head.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

/** Characters per group, and groups per code: XXXXX-XXXXX. */
const GROUP = 5
const GROUPS = 2

/**
 * One code's worth of entropy.
 *
 * 10 characters from a 32 letter alphabet is 50 bits. Against a hashed,
 * rate-limited, ten-at-a-time set that is far beyond what is needed, and it
 * keeps the code short enough to read aloud.
 */
export function generateRecoveryCode(): string {
  const chars: string[] = []
  // randomInt rather than Math.random, and rather than taking bytes modulo the
  // alphabet length: 256 is not a multiple of 32 here by luck, and reaching for
  // modulo is how a biased generator gets written by accident.
  for (let i = 0; i < GROUP * GROUPS; i++) {
    chars.push(ALPHABET[crypto.randomInt(0, ALPHABET.length)])
  }
  const groups: string[] = []
  for (let i = 0; i < GROUPS; i++) {
    groups.push(chars.slice(i * GROUP, (i + 1) * GROUP).join(""))
  }
  return groups.join("-")
}

/** A fresh set. */
export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>()
  // A duplicate inside one set would be two codes that both stop working when
  // one is redeemed. Astronomically unlikely, cheap to make impossible.
  while (codes.size < count) codes.add(generateRecoveryCode())
  return Array.from(codes)
}

/**
 * Put a typed code into the form it was stored in.
 *
 * Upper-cases, strips everything that is not in the alphabet, and re-groups.
 * So "abcde fghjk", "ABCDE-FGHJK" and "abcdefghjk" are all the same code. A
 * person reading one off a photograph should not fail because they left the
 * hyphen out.
 *
 * O/o and I/i/L/l are mapped to 0 and 1 rather than dropped: they cannot appear
 * in a real code, so their presence means somebody read a zero as a letter,
 * which is the single most common transcription error this alphabet exists to
 * avoid. Fixing it is strictly better than refusing it.
 */
export function normaliseRecoveryCode(raw: string | null | undefined): string {
  const upper = String(raw ?? "").toUpperCase()
  const mapped = upper.replace(/[OIL]/g, c => (c === "O" ? "0" : "1"))
  const kept = mapped.split("").filter(c => ALPHABET.includes(c)).join("")
  if (kept.length !== GROUP * GROUPS) return kept // wrong length: let the caller refuse it
  const groups: string[] = []
  for (let i = 0; i < GROUPS; i++) {
    groups.push(kept.slice(i * GROUP, (i + 1) * GROUP))
  }
  return groups.join("-")
}

/** Is this the right shape to even bother hashing against the stored set? */
export function looksLikeRecoveryCode(raw: string | null | undefined): boolean {
  const normalised = normaliseRecoveryCode(raw)
  return new RegExp(`^[${ALPHABET}]{${GROUP}}-[${ALPHABET}]{${GROUP}}$`).test(normalised)
}
