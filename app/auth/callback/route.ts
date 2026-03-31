import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  const next = searchParams.get('next')
  const supabase = await createClient()

  async function routeByRole() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.redirect(`${origin}/login?error=auth`)
    const service = await createServiceClient()
    const { data: userData } = await service.from('users').select('role, email').eq('auth_user_id', user.id).single()
    if (userData?.role === 'installer') {
      return NextResponse.redirect(`${origin}/installer/setup?email=${encodeURIComponent(userData.email)}`)
    }
    return NextResponse.redirect(`${origin}/admin`)
  }

  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash, type: type as any })
    if (!error) {
      if (next) return NextResponse.redirect(`${origin}${next}`)
      return routeByRole()
    }
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      if (next) return NextResponse.redirect(`${origin}${next}`)
      return routeByRole()
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`)
}

