import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import bcrypt from 'bcryptjs'

const INVITE_EXPIRED = 'Your invite link has expired. Please ask your manager to resend your invite.'

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
      .select('id, pin_reset_expires')
      .eq('pin_reset_token', token)
      .single()
    if (!user || !user.pin_reset_expires || new Date(user.pin_reset_expires) < new Date()) {
      return NextResponse.json({ error: INVITE_EXPIRED }, { status: 401 })
    }
    userId = user.id
  } else if (email) {
    // Email path — the documented new-installer flow. Only allowed when no PIN
    // has been set yet, so it can't be used to overwrite an existing PIN.
    const { data: user } = await service
      .from('users')
      .select('id, pin_hash')
      .ilike('email', String(email).trim())
      .single()
    if (!user) return NextResponse.json({ error: INVITE_EXPIRED }, { status: 401 })
    if (user.pin_hash) {
      return NextResponse.json({ error: 'A PIN is already set for this account. Tap "Forgot PIN" to reset it.' }, { status: 400 })
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
