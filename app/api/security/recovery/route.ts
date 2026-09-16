// app/api/security/recovery/route.ts
//
// POST { code } -- redeem a recovery code.
//
// What this does, precisely: it REMOVES the caller's authenticator. It does not
// grant aal2 and it cannot -- the assurance level is Supabase's to issue, and
// minting our own claim that a second factor had been satisfied would be
// inventing a parallel truth about authentication.
//
// So the sequence for a lost phone is: sign in with the password (aal1), redeem
// a code, the factor is deleted, and the policy in lib/mfa.ts then sends a
// superadmin straight to enrol a new one. They are never both locked out and
// unprotected.
//
// The whole set dies with the factor. Every remaining code referred to an
// authenticator that no longer exists, so leaving them alive would leave ten
// valid-looking keys to a door that has been rehung.

import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { createClient, createServiceClient } from "@/lib/supabase/server"
import { looksLikeRecoveryCode, normaliseRecoveryCode } from "@/lib/mfa-recovery"
import { checkRateLimit } from "@/lib/rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  // A password session is still required. A recovery code is the SECOND factor
  // standing in for a lost phone, never a way in from nothing.
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Rate limited per account. Ten live codes drawn from a 50-bit space are not
  // guessable, but an endpoint that compares secrets is worth throttling on
  // principle, and it stops bcrypt being used as a CPU amplifier.
  const allowed = await checkRateLimit(`mfa-recovery:${user.id}`, 10, 15 * 60)
  if (!allowed) {
    console.warn(`[mfa] recovery rate limit hit for auth_user=${user.id}`)
    return NextResponse.json(
      { error: "Too many attempts. Wait fifteen minutes and try again." },
      { status: 429 },
    )
  }

  const body = await request.json().catch(() => null)
  if (!looksLikeRecoveryCode(body?.code)) {
    // Refused on shape before any hashing, so a pasted TOTP code costs nothing.
    return NextResponse.json({ error: "That is not a recovery code" }, { status: 400 })
  }
  const code = normaliseRecoveryCode(body.code)

  const service = await createServiceClient()
  const { data: live, error: readErr } = await service
    .from("mfa_recovery_codes")
    .select("id, code_hash")
    .eq("auth_user_id", user.id)
    .is("used_at", null)

  if (readErr) {
    console.error("[mfa] could not read recovery codes:", readErr.message)
    return NextResponse.json({ error: "Could not check that code" }, { status: 500 })
  }

  // Every live hash is compared, with no early exit on a match, so how long
  // this takes does not reveal which code matched or where in the set it sat.
  let matchedId: string | null = null
  for (const row of (live ?? []) as any[]) {
    const isMatch = await bcrypt.compare(code, row.code_hash)
    if (isMatch && !matchedId) matchedId = row.id
  }

  if (!matchedId) {
    console.warn(`[mfa] failed recovery attempt for auth_user=${user.id}`)
    return NextResponse.json({ error: "That code was not recognised" }, { status: 400 })
  }

  // Marked spent BEFORE the factor is touched, so that if anything below fails
  // there is still a record that this code was used.
  await service
    .from("mfa_recovery_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("id", matchedId)

  // Delete every factor on the account, through the admin API. The user's own
  // client cannot do this: Supabase requires aal2 to unenroll a verified
  // factor, and the whole reason they are here is that they cannot reach aal2.
  const { data: factorList, error: listErr } = await service.auth.admin.mfa.listFactors({
    userId: user.id,
  })
  if (listErr) {
    console.error("[mfa] could not list factors during recovery:", listErr.message)
    return NextResponse.json(
      { error: "Could not remove the authenticator. Contact support." },
      { status: 500 },
    )
  }

  for (const factor of factorList?.factors ?? []) {
    const { error } = await service.auth.admin.mfa.deleteFactor({
      userId: user.id,
      id: factor.id,
    })
    if (error) {
      console.error("[mfa] could not delete factor during recovery:", error.message)
      return NextResponse.json(
        { error: "Could not remove the authenticator. Contact support." },
        { status: 500 },
      )
    }
  }

  // The rest of the set referred to the factor that has just gone.
  await service
    .from("mfa_recovery_codes")
    .delete()
    .eq("auth_user_id", user.id)
    .is("used_at", null)

  // A security event, logged as one. Somebody redeeming a recovery code is
  // either a person who lost a phone or an attacker holding the password, and
  // both are worth being able to find afterwards.
  console.warn(`[mfa] recovery code redeemed, factors removed for auth_user=${user.id}`)

  return NextResponse.json({ ok: true })
}
