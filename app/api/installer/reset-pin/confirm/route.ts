import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import bcrypt from 'bcryptjs'

export async function POST(request: Request) {
  const { token, pin } = await request.json()
  if (!token || !pin || pin.length !== 4) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const service = await createServiceClient()
  const { data: user } = await service.from('users').select('id, pin_reset_expires').eq('pin_reset_token', token).single()
  if (!user) return NextResponse.json({ error: 'Invalid or expired reset link' }, { status: 400 })
  if (new Date(user.pin_reset_expires) < new Date()) return NextResponse.json({ error: 'Reset link has expired. Please request a new one.' }, { status: 400 })

  const hash = await bcrypt.hash(pin, 10)
  await service.from('users').update({ pin_hash: hash, pin_reset_token: null, pin_reset_expires: null, pin_attempts: 0, pin_locked_until: null }).eq('id', user.id)

  return NextResponse.json({ success: true })
}