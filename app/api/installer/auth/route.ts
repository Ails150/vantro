import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import bcrypt from 'bcryptjs'

export async function POST(request: Request) {
  const { pin } = await request.json()
  if (!pin || pin.length !== 4) {
    return NextResponse.json({ error: 'Invalid PIN' }, { status: 400 })
  }

  const service = await createServiceClient()

  // Get all active installers with PINs
  const { data: users } = await service
    .from('users')
    .select('id, name, company_id, pin_hash, pin_attempts, pin_locked_until, role')
    .eq('is_active', true)
    .not('pin_hash', 'is', null)

  if (!users) return NextResponse.json({ error: 'Incorrect PIN' }, { status: 401 })

  // Find matching PIN
  let matchedUser = null
  for (const user of users) {
    if (user.pin_locked_until && new Date(user.pin_locked_until) > new Date()) {
      continue // Skip locked accounts
    }
    if (user.pin_hash && await bcrypt.compare(pin, user.pin_hash)) {
      matchedUser = user
      break
    }
  }

  if (!matchedUser) {
    // Increment attempts on all users with this pin attempt (simplified)
    return NextResponse.json({ error: 'Incorrect PIN. Please try again.' }, { status: 401 })
  }

  // Reset attempts on successful login
  await service
    .from('users')
    .update({ pin_attempts: 0, pin_locked_until: null })
    .eq('id', matchedUser.id)

  // Create a simple session token (in production use JWT)
  const token = Buffer.from(JSON.stringify({
    userId: matchedUser.id,
    companyId: matchedUser.company_id,
    exp: Date.now() + 8 * 60 * 60 * 1000 // 8 hours
  })).toString('base64')

  return NextResponse.json({
    token,
    userId: matchedUser.id,
    name: matchedUser.name,
    companyId: matchedUser.company_id,
    role: matchedUser.role
  })
}
