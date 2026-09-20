import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import bcrypt from 'bcryptjs'
import { escapeLikePattern } from '@/lib/sql-escape'
import { canHoldPin } from '@/lib/roles'

const INVITE_EXPIRED = 'Your invite link has expired. Please ask your manager to resend your invite.'

/**
 * The single answer the email path gives to every failure.
 *
 * Deliberately covers both "no such address" and "that account already has a
 * PIN" without saying which, because the difference between those two answers
 * is a way to find out who works for a company.
 */
const SETUP_REFUSED =
  'We could not set a PIN for that email address. If you already have a PIN, ' +
  'use "Forgot PIN" to reset it. If you have just been invited, check the ' +
  'address with your manager.'

// New-installer PIN setup. The invite email is email-based ("enter this email
// address and choose a PIN"), so the app sends { email, pin } with NO token —
// that's the primary path. A token path is also supported (reset links).
export async function POST(request: Request) {
  const { pin, token, email } = await request.json()
  if (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
    return NextResponse.json({ error: 'PIN must be 4 digits' }, { status: 400 })
  }

  const ip = getClientIp(request)
  const ok = await checkRateLimit(`setup-pin:ip:${ip}`, 20, 600)
  if (!ok) return NextResponse.json({ error: 'Too many attempts. Try again in a few minutes.' }, { status: 429 })

  const service = await createServiceClient()
  let userId: string | null = null

  if (token) {
    // Token path (e.g. a reset/invite link that carries a token).
    const { data: user } = await service
      .from('users')
      .select('id, role, pin_reset_expires')
      .eq('pin_reset_token', token)
      .single()
    if (!user || !user.pin_reset_expires || new Date(user.pin_reset_expires) < new Date()) {
      return NextResponse.json({ error: INVITE_EXPIRED }, { status: 401 })
    }
    // The same allowlist as the email path below. It was missing here, so a
    // token issued for an office account would have set a PIN on it -- the
    // hole the email path was hardened against, reachable one route over.
    if (!canHoldPin(user.role)) {
      return NextResponse.json({ error: INVITE_EXPIRED }, { status: 401 })
    }
    userId = user.id
  } else if (email) {
    // Email path — the documented new-installer flow. Only allowed when no PIN
    // has been set yet, so it can't be used to overwrite an existing PIN.
    const { data: user } = await service
      .from('users')
      .select('id, pin_hash, role')
      .ilike('email', escapeLikePattern(String(email).trim()))
      .maybeSingle()

    // FIELD ROLES ONLY, and this was found the hard way.
    //
    // A probe against production sent this route an ADMIN's email address with
    // a four-digit PIN, and it set one — 200, no credential, no invite token.
    // The route looks a user up by address and sets a PIN if they do not have
    // one, and it never asked what kind of account it was doing that to.
    //
    // An admin signs in with a password, not a PIN. They have no reason to have
    // one, which means they permanently satisfy the "no PIN yet" condition —
    // every admin account was standing open to anybody who knew the address.
    // The PIN would then mint a field token for that person: their jobs, their
    // hours, sign-ins recorded in their name.
    //
    // What this does NOT fix, and is a decision rather than a bug: an installer
    // who has been invited but has not yet set their PIN can still have it set
    // by anybody who knows their address. That is the documented new-installer
    // flow — the invite email says "enter your email and choose a PIN" — and
    // closing it means issuing a token per invite. Worth doing; bigger than
    // this commit.
    //
    // THE LIST LIVES IN lib/roles.ts NOW. It was ['installer', 'subcontractor']
    // written out here, and the stored value for a new worker is 'field' --
    // so every worker added through the setup wizard's team step, the CSV
    // import or /api/onboarding was refused a PIN and could not log in. The
    // control was right and its vocabulary was a release out of date.
    if (user && !canHoldPin(user.role)) {
      return NextResponse.json({ error: SETUP_REFUSED }, { status: 401 })
    }

    // ONE ANSWER FOR BOTH FAILURES, and that is the point of this block.
    //
    // It used to return 401 "invite expired" when the address was unknown and
    // 400 "a PIN is already set" when it was known. Two different answers is an
    // account oracle: ask this route about an address and it tells you whether
    // somebody works there. Closing the oracle on the sign-in route while
    // leaving it here would have moved it, not removed it.
    //
    // The wording has to cover both cases without saying which, so it names the
    // two things the person can actually do next. Somebody who genuinely has a
    // PIN is told to use Forgot PIN; somebody mistyping is told to check the
    // address. Neither learns anything about the other.
    if (!user || user.pin_hash) {
      return NextResponse.json({ error: SETUP_REFUSED }, { status: 401 })
    }
    userId = user.id
  } else {
    return NextResponse.json({ error: INVITE_EXPIRED }, { status: 400 })
  }

  const pin_hash = await bcrypt.hash(pin, 10)
  const { error } = await service.from('users').update({
    pin_hash,
    pin_reset_token: null,
    pin_reset_expires: null,
  }).eq('id', userId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ success: true })
}
