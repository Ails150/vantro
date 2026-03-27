import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const service = await createServiceClient()
  const { email, name, role } = await request.json()

  const redirectTo = (role === 'foreman' || role === 'admin')
    ? `https://app.getvantro.com/login`
    : `https://app.getvantro.com/installer/setup?email=${encodeURIComponent(email)}`

  const { error } = await service.auth.admin.inviteUserByEmail(email, { redirectTo })

  if (error && error.message.includes('already been registered')) {
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
    if (resetError) return NextResponse.json({ error: resetError.message }, { status: 400 })
    return NextResponse.json({ success: true })
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
