import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const service = await createServiceClient()
  const { email, name } = await request.json()

  // Try invite first - if user exists, send password reset instead
  const { error } = await service.auth.admin.inviteUserByEmail(email, {
    redirectTo: `https://app.getvantro.com/installer/setup?email=${encodeURIComponent(email)}`
  })

  if (error && error.message.includes('already been registered')) {
    // User exists - send password reset
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `https://app.getvantro.com/installer/setup?email=${encodeURIComponent(email)}`
    })
    if (resetError) return NextResponse.json({ error: resetError.message }, { status: 400 })
    return NextResponse.json({ success: true })
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
