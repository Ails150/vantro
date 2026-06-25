import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// After a client-side session is established (e.g. from an invite link whose
// tokens arrive in the URL hash), this route reads the session cookie and
// redirects the user to the right place for their role.
export async function GET(request: Request) {
  const { origin } = new URL(request.url)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${origin}/login?error=auth`)

  const service = await createServiceClient()
  // limit(1) rather than .single() so a duplicate auth_user_id row can't break routing.
  const { data: rows } = await service
    .from('users')
    .select('role')
    .eq('auth_user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
  const userData = rows?.[0]

  if (userData?.role === 'installer') {
    return NextResponse.redirect(`${origin}/installer`)
  }
  return NextResponse.redirect(`${origin}/admin`)
}
