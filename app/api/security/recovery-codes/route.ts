// app/api/security/recovery-codes/route.ts
//
// POST -- issue a fresh set of recovery codes for the caller.
//
// Called once, by the enrolment screen, immediately after a factor is verified.
// The codes are returned in the clear exactly once and only bcrypt hashes are
// kept, so this is the only moment they can ever be shown.
//
// Issuing REPLACES any previous set. A set belongs to a factor; once a new
// authenticator is enrolled the old codes would delete a factor that no longer
// exists, so leaving them alive would be leaving ten valid-looking keys to a
// door that has been rehung.

import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { createClient, createServiceClient } from "@/lib/supabase/server"
import { RECOVERY_CODE_COUNT, generateRecoveryCodes } from "@/lib/mfa-recovery"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST() {
  // The caller's own session, whatever its assurance level. Somebody who has
  // just verified a factor is at aal2; somebody re-issuing from Settings may be
  // too. Either way they have proven they are this account.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Codes are only meaningful next to a real factor. Refusing here stops a set
  // being minted for an account with nothing to recover, which would be ten
  // strings that do nothing and a false sense of having a backup.
  const { data: factors } = await supabase.auth.mfa.listFactors()
  const verified = (factors?.totp ?? []).some(f => f.status === "verified")
  if (!verified) {
    return NextResponse.json(
      { error: "Set up an authenticator before generating recovery codes" },
      { status: 400 },
    )
  }

  const codes = generateRecoveryCodes(RECOVERY_CODE_COUNT)
  // Cost 10, matching worker PINs in this codebase. Ten hashes at cost 10 is
  // roughly a second, which is acceptable for a once-per-enrolment call and is
  // the point of a slow hash.
  const rows = await Promise.all(
    codes.map(async code => ({
      auth_user_id: user.id,
      code_hash: await bcrypt.hash(code, 10),
    })),
  )

  const service = await createServiceClient()

  // The ids of the outgoing set, captured BEFORE the new one is written.
  //
  // Identifying the old rows by id rather than by "everything that is not one
  // of the new hashes" is deliberate: a bcrypt hash contains $ and / and
  // embedding a list of them in a PostgREST filter is a quoting bug waiting to
  // happen, whose failure mode is deleting the wrong rows.
  const { data: previous } = await service
    .from("mfa_recovery_codes")
    .select("id")
    .eq("auth_user_id", user.id)
    .is("used_at", null)

  // Insert first, delete second. If the insert fails the user keeps their old
  // set rather than being left with none, which is the safer way round to fail.
  const { error: insertErr } = await service.from("mfa_recovery_codes").insert(rows)
  if (insertErr) {
    console.error("[mfa] could not store recovery codes:", insertErr.message)
    return NextResponse.json({ error: "Could not generate recovery codes" }, { status: 500 })
  }

  const staleIds = (previous ?? []).map((r: any) => r.id)
  if (staleIds.length > 0) {
    const { error: clearErr } = await service
      .from("mfa_recovery_codes")
      .delete()
      .in("id", staleIds)
    if (clearErr) {
      // Not fatal: the new set works. Old codes lingering is a smaller problem
      // than refusing somebody the codes they just asked for.
      console.error("[mfa] could not clear previous recovery codes:", clearErr.message)
    }
  }

  console.log(`[mfa] issued ${codes.length} recovery codes for auth_user=${user.id}`)

  // The one and only time these leave the server.
  return NextResponse.json({ codes })
}
