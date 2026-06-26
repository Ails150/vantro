import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import bcrypt from 'bcryptjs'

export async function POST(request: Request) {
  const { pin, token } = await request.json()
  if (!pin || pin.length !== 4) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  if (!/^\d{4}$/.test(pin)) return NextResponse.json({ error: 'PIN must be 4 digits' }, { status: 400 })
  const INVITE_EXPIRED = 'Your invite link has expired. Please ask your manager to resend your invite.'
  if (!token) return NextResponse.json({ error: INVITE_EXPIRED }, { status: 400 })

  const service = await createServiceClient()
  // Look up user by token only - token is unique and uniquely identifies the user
  const { data: user } = await service
    .from('users')
    .select('id, pin_reset_token, pin_reset_expires')
    .eq('pin_reset_token', token)
    .single()

  if (!user) return NextResponse.json({ error: INVITE_EXPIRED }, { status: 401 })
  if (!user.pin_reset_expires || new Date(user.pin_reset_expires) < new Date()) {
    return NextResponse.json({ error: INVITE_EXPIRED }, { status: 401 })
  }

  const pin_hash = await bcrypt.hash(pin, 10)
  const { error } = await service.from('users').update({
    pin_hash,
    pin_reset_token: null,
    pin_reset_expires: null,
  }).eq('id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ success: true })
}
