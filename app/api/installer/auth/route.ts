import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { createFieldToken } from '@/lib/auth'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import bcrypt from 'bcryptjs'

const MAX_PIN_ATTEMPTS = 5
const LOCKOUT_MINUTES = 15

// A real bcrypt hash of a value nobody can supply, compared against when the
// email is unknown so the work done matches the found-user path.
const DUMMY_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy'

export async function POST(request: Request) {
  // Rate limit: 20 attempts per IP per 10 minutes (allows legit installer retries, blocks brute force)
  const ip = getClientIp(request)
  const ok = await checkRateLimit(`installer-auth:ip:${ip}`, 20, 600)
  if (!ok) {
    return NextResponse.json({ error: 'Too many attempts. Try again in a few minutes.' }, { status: 429 })
  }

  const body = await request.json()

  if (body.checkOnly) {
    const service = await createServiceClient()
    const { data: user } = await service.from('users').select('id, pin_hash').ilike('email', body.email).single()
    if (!user) return NextResponse.json({ exists: false })
    return NextResponse.json({ exists: true, hasPin: !!user.pin_hash })
  }

  const { pin } = body
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!pin || pin.length !== 4) return NextResponse.json({ error: 'Invalid PIN' }, { status: 400 })

  // A 4 digit PIN cannot identify a person. Matching it against every company's
  // users meant the first colliding hash won, so one company's installer could
  // be issued a token for another company's account. The email narrows this to
  // exactly one row before any comparison happens.
  if (!email) {
    return NextResponse.json({ error: 'Email and PIN are both required.' }, { status: 400 })
  }

  // Per account limit, so rotating IPs does not buy more guesses. 5 per 15 min.
  const perEmailOk = await checkRateLimit(`installer-auth:email:${email}`, 5, 900)
  if (!perEmailOk) {
    return NextResponse.json({ error: 'Too many attempts. Try again in a few minutes.' }, { status: 429 })
  }

  const service = await createServiceClient()
  const { data: user } = await service
    .from('users')
    .select('id, name, company_id, subcontractor_id, pin_hash, pin_attempts, pin_locked_until, role, gps_tracking_acknowledged')
    .ilike('email', email)
    .eq('is_active', true)
    .not('pin_hash', 'is', null)
    .maybeSingle()

  // Same message, same status, same shape whether the email is unknown or the
  // PIN is wrong, so this cannot be used to discover who has an account.
  const REJECT = NextResponse.json({ error: 'Incorrect email or PIN. Please try again.' }, { status: 401 })

  // Spend the same time on an unknown email as on a real one. Without this the
  // response time alone answers "does this address have an account".
  if (!user) {
    await bcrypt.compare(pin, DUMMY_HASH)
    return REJECT
  }

  if (user.pin_locked_until && new Date(user.pin_locked_until) > new Date()) {
    await bcrypt.compare(pin, DUMMY_HASH)
    return REJECT
  }

  const matches = await bcrypt.compare(pin, user.pin_hash as string)

  if (!matches) {
    // Lockout that actually bites: the counter is per account and is what stops
    // an attacker who has the email and is walking the 10,000 PINs.
    const attempts = (user.pin_attempts || 0) + 1
    const update: any = { pin_attempts: attempts }
    if (attempts >= MAX_PIN_ATTEMPTS) {
      update.pin_attempts = 0
      update.pin_locked_until = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString()
    }
    await service.from('users').update(update).eq('id', user.id)
    return REJECT
  }

  const matchedUser = user
  await service.from('users').update({ pin_attempts: 0, pin_locked_until: null }).eq('id', matchedUser.id)

  const token = createFieldToken(matchedUser.id, matchedUser.company_id, matchedUser.subcontractor_id || null)

  return NextResponse.json({
    token,
    userId: matchedUser.id,
    name: matchedUser.name,
    companyId: matchedUser.company_id,
    subcontractorId: matchedUser.subcontractor_id || null,
    role: matchedUser.role,
    gpsAcknowledged: matchedUser.gps_tracking_acknowledged || false,
  })
}
