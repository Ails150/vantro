import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import bcrypt from 'bcryptjs'

export async function POST(request: Request) {
  const { email, pin } = await request.json()
  if (!email || !pin || pin.length !== 4) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  if (!/^\d{4}$/.test(pin)) return NextResponse.json({ error: 'PIN must be 4 digits' }, { status: 400 })

  const service = await createServiceClient()
  const { data: user } = await service.from('users').select('id').ilike('email', email).single()
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const pin_hash = await bcrypt.hash(pin, 10)
  const { error } = await service.from('users').update({ pin_hash }).eq('id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ success: true })
}
