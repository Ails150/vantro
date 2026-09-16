import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import { installerGate } from '@/lib/installer-rate-limit'

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  // Rate limit the field app here, before anything else runs.
  //
  // This is the only place that covers every /api/installer route at once.
  // Guarding each handler is a policy that holds until somebody adds a route
  // and forgets, and the forgetting is silent: nothing fails, the route simply
  // has no limit. See lib/installer-rate-limit.ts for why there are two
  // buckets and why the per-token one cannot be the whole answer.
  //
  // It runs before updateSession because field requests carry a bearer token
  // and no Supabase cookie, so the session refresh below has nothing to do for
  // them -- and a request that is going to be refused should not cost a round
  // trip to the auth server first.
  if (pathname.startsWith('/api/installer')) {
    const refusal = await installerGate(request)
    if (refusal) return refusal
    // Field requests have no Supabase session to refresh, and the MFA gate
    // exempts /api/installer anyway. Returning here saves a call to the auth
    // server on the busiest path in the product.
    return NextResponse.next({ request })
  }

  return await updateSession(request)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
