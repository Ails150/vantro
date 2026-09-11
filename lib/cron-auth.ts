// lib/cron-auth.ts
//
// The one check every scheduled route makes.
//
// Each of them had written it inline as:
//
//     if (auth !== `Bearer ${process.env.CRON_SECRET}`) return 401
//
// which is correct exactly as long as CRON_SECRET is set. If it is missing --
// a new environment, a preview deploy, a variable renamed in the dashboard --
// the template collapses to the literal string "Bearer undefined", and anyone
// who sends that header can run the job. The failure is silent and it opens up
// precisely when configuration is least certain.
//
// So an absent secret is a refusal, not a wildcard, and the comparison is
// length-safe rather than a bare !==.

import { timingSafeEqual } from "crypto"

export type CronAuth = { ok: true } | { ok: false; reason: string }

export function authoriseCron(request: Request): CronAuth {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    // Loud, because this is a misconfiguration that would otherwise present as
    // "the nightly job mysteriously stopped running".
    console.error("[cron] CRON_SECRET is not set; refusing every scheduled call")
    return { ok: false, reason: "not configured" }
  }

  const header = request.headers.get("authorization")
  if (!header?.startsWith("Bearer ")) return { ok: false, reason: "missing bearer" }

  const given = Buffer.from(header.slice(7))
  const expected = Buffer.from(secret)
  // timingSafeEqual throws on a length mismatch, so that is checked first --
  // and a differing length is already a mismatch.
  if (given.length !== expected.length) return { ok: false, reason: "bad secret" }
  if (!timingSafeEqual(given, expected)) return { ok: false, reason: "bad secret" }

  return { ok: true }
}
