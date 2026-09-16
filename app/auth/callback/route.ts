import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { safeNextPath } from '@/lib/safe-redirect'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  // Reduced to a same-origin path before it is used anywhere.
  //
  // `${origin}${next}` with next = "@evil.example.com" produces a URL whose
  // HOST is evil.example.com and whose username is app.getvantro.com. On a
  // magic-link callback that is a phishing link the victim cannot tell from a
  // real one: it is a real one, with a valid token, that signs them in and then
  // hands them to somebody else. Confirmed against production before the fix.
  //
  // null rather than a default, so the role-based routing below still runs when
  // no next was given -- an installer must not be sent to /admin.
  const rawNext = searchParams.get('next')
  const next = rawNext ? safeNextPath(rawNext) : null
  const supabase = await createClient()

  async function routeByRole() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.redirect(`${origin}/login?error=auth`)
    const service = await createServiceClient()
    const { data: userData } = await service.from('users').select('role, email').eq('auth_user_id', user.id).single()
    if (userData?.role === 'installer') {
      const email = encodeURIComponent(userData.email || user.email || '')
      return NextResponse.redirect(`${origin}/installer/setup?email=${email}`)
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
