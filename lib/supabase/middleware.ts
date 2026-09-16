import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { assuranceLevelFromToken, hasVerifiedFactor, isMfaExempt } from '@/lib/mfa'

/**
 * Refresh the Supabase session, and hold a session that has not satisfied its
 * second factor at the door.
 *
 * WHY THE STEP-UP CHECK IS HERE AND THE ENROLMENT CHECK IS NOT
 *
 * "This account has an authenticator and this session has not used it" is
 * answerable from the access token and the user object alone -- the aal claim
 * and user.factors -- with no database query. That makes it cheap enough to run
 * on every request, which is exactly where it belongs: it then covers every API
 * route without forty separate guards, and a stolen password alone reaches
 * nothing.
 *
 * "This role is required to have an authenticator and has none" needs the
 * user's role, which lives in our users table, not in the token. Querying it on
 * every request would put a database round trip in front of every asset for a
 * check that only matters at one screen. So that half is enforced in
 * app/admin/page.tsx, where the role has already been loaded. The threat model
 * survives the split: mandatory enrolment protects against a future password
 * compromise, and the moment a superadmin HAS enrolled, the middleware above
 * covers them everywhere.
 *
 * IT FAILS OPEN, AND SAYS SO
 * Any error reading the MFA state lets the request through and logs. This is
 * the same judgement the RAMS gate makes and for the same reason: a broken read
 * must not lock every administrator out of the product, and a missed step-up is
 * recoverable while a company that cannot reach its own data is not. The
 * difference from RAMS is that this one fails open only on ERROR -- a session
 * we can positively read as aal1 with a verified factor is refused.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname

  // No session, or a path that must stay reachable. The exempt list is what
  // stops this being a trap -- without it the enrolment screen redirects to
  // itself and somebody who cannot finish enrolling cannot even sign out.
  if (!user || isMfaExempt(pathname)) return supabaseResponse

  try {
    if (!hasVerifiedFactor(user)) return supabaseResponse

    // getSession() is safe to use here purely to read the token: getUser()
    // above has already verified this session against the auth server, so the
    // token is known genuine and this only reads a claim out of it.
    const { data: { session } } = await supabase.auth.getSession()
    const level = assuranceLevelFromToken(session?.access_token)

    // null means the claim could not be read. Treated as "cannot tell" and let
    // through, not as aal1 -- see the fail-open note above.
    if (level !== 'aal1') return supabaseResponse

    if (pathname.startsWith('/api/')) {
      // An API caller gets a machine-readable refusal rather than a redirect to
      // an HTML page it cannot use. 401 with a code the client can branch on.
      return NextResponse.json(
        { error: 'Two-factor verification required', code: 'mfa_required' },
        { status: 401 },
      )
    }

    const url = request.nextUrl.clone()
    url.pathname = '/security/verify'
    // Where they were going, so they land back there after entering a code
    // rather than on a generic dashboard.
    url.searchParams.set('next', pathname + request.nextUrl.search)
    return NextResponse.redirect(url)
  } catch (err: any) {
    console.error('[mfa] step-up check failed, allowing through:', err?.message || err)
    return supabaseResponse
  }
}
