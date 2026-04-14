import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { createInstallerToken } from '@/lib/auth'
import bcrypt from 'bcryptjs'

export async function POST(request: Request) {
  const body = await request.json()

  if (body.checkOnly) {
    const service = await createServiceClient()
    const { data: user } = await service.from('users').select('id, pin_hash').ilike('email', body.email).single()
    if (!user) return NextResponse.json({ exists: false })
    return NextResponse.json({ exists: true, hasPin: !!user.pin_hash })
  }

  const { pin } = body
  if (!pin || pin.length !== 4) return NextResponse.json({ error: 'Invalid PIN' }, { status: 400 })

  const service = await createServiceClient()
  const { data: users } = await service.from('users').select('id, name, company_id, pin_hash, pin_attempts, pin_locked_until, role, gps_tracking_acknowledged').eq('is_active', true).not('pin_hash', 'is', null)
  if (!users) return NextResponse.json({ error: 'Incorrect PIN' }, { status: 401 })

  let matchedUser = null
  for (const user of users) {
    if (user.pin_locked_until && new Date(user.pin_locked_until) > new Date()) continue
    if (user.pin_hash && await bcrypt.compare(pin, user.pin_hash)) { matchedUser = user; break }
  }

  if (!matchedUser) {
    return NextResponse.json({ error: 'Incorrect PIN. Please try again.' }, { status: 401 })
  }

  await service.from('users').update({ pin_attempts: 0, pin_locked_until: null }).eq('id', matchedUser.id)

  const token = createInstallerToken(matchedUser.id, matchedUser.company_id)

  return NextResponse.json({
    token,
    userId: matchedUser.id,
    name: matchedUser.name,
    companyId: matchedUser.company_id,
    role: matchedUser.role,
    gpsAcknowledged: matchedUser.gps_tracking_acknowledged || false,
  })
}