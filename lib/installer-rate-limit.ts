// lib/installer-rate-limit.ts
//
// Rate limiting for the field app, applied in middleware.
//
// WHY MIDDLEWARE AND NOT THIRTY ROUTE HANDLERS. There are eighteen routes under
// /api/installer today and there will be more. Adding a guard to each one is a
// policy that holds exactly until somebody adds a nineteenth and forgets, and
// the forgetting is silent -- nothing fails, the route simply has no limit.
// Middleware sees every request to the prefix whether or not anybody remembered.
//
// WHY TWO BUCKETS, AND WHY THE TOKEN ONE IS NOT ENOUGH ON ITS OWN.
//
// The brief asked for a limit per token, and that is the inner bucket. It does
// real work: it stops a stolen token being used to walk a company's history,
// and it stops a client stuck in a retry loop from hammering the API.
//
// But it cannot be the whole answer, because middleware does not verify the
// token's signature -- doing so would mean shipping JWT_SECRET to the edge --
// so the token is attacker-controlled input. Anyone can vary it and get a fresh
// bucket every request. The token bucket is therefore keyed on a HASH OF THE
// WHOLE TOKEN rather than on the userId claim inside it: a forged token gets
// its own bucket and cannot poison the bucket of the real one it is imitating,
// but varying the token still escapes the limit.
//
// So the outer bucket is by IP, which cannot be varied for free, and it is the
// one that actually stops a flood. It is set high -- twenty workers behind one
// site's 4G router all legitimately share an address -- so it is a ceiling
// rather than a limit, and the token bucket does the precise work underneath it.

import { rateLimit, rateLimitedResponse, getClientIp, type RateLimitResult, LIMITS } from "@/lib/rate-limit"

/**
 * A ceiling for one source address.
 *
 * Deliberately generous. A gang of twenty on one site shares a router, and
 * blocking a site because it is busy is a worse failure than letting a flood
 * run for a few more seconds. It stops the thing it is for -- thousands of
 * requests a minute from one place -- without touching anything real.
 */
export const INSTALLER_IP_CEILING = { max: 600, windowSeconds: 60 }

/** The bearer token on the request, if there is one. */
export function bearerToken(headers: Headers): string | null {
  const auth = headers.get("authorization") || headers.get("Authorization")
  if (!auth) return null
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim())
  return m ? m[1].trim() : null
}

/**
 * A stable, short, non-reversible id for a token.
 *
 * The raw token never becomes part of a rate-limit key, because keys reach logs
 * and Sentry, and a key containing a live ninety-day credential would leak it
 * to exactly the place the mobile scrubbing work was done to keep it out of.
 */
export async function tokenBucketId(token: string): Promise<string> {
  const data = new TextEncoder().encode(token)
  const digest = await crypto.subtle.digest("SHA-256", data)
  const bytes = new Uint8Array(digest).slice(0, 8)
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("")
}

/**
 * Routes that legitimately arrive with no credential, because obtaining one is
 * what they are for.
 *
 * FOUND BY THE SUITE, NOT BY READING. The anonymous bucket is 20 a minute per
 * address, and /api/installer/auth carries no Authorization header -- so every
 * PIN sign-in was landing in it. A gang of twenty arriving at seven in the
 * morning behind one site's 4G router would have hit the limit and been unable
 * to start work, which is a far worse outcome than the abuse the bucket exists
 * to stop.
 *
 * These routes are not unprotected as a result. Each has its own limits inside
 * the handler, and they are better than anything this layer could apply: per IP
 * AND per address, with a five-strike lockout on the account itself. The IP
 * ceiling above still covers them.
 */
const CREDENTIAL_ROUTES = [
  "/api/installer/auth",
  "/api/installer/setup-pin",
  "/api/installer/reset-pin",
]

export function isCredentialRoute(pathname: string): boolean {
  return CREDENTIAL_ROUTES.some(p => pathname === p || pathname.startsWith(p + "/"))
}

export type InstallerLimitOutcome = {
  limited: boolean
  result: RateLimitResult
  max: number
  /** Which bucket tripped. For the log, never for the client. */
  bucket: "ip" | "token" | "anon"
}

/**
 * Apply both buckets to one field-app request.
 *
 * Order matters: the IP ceiling is checked first so that a flood is refused
 * before it can consume the token bucket of whatever token it happens to be
 * carrying -- otherwise an attacker with a stolen token could lock out the
 * worker it belongs to, turning a limiter into a denial of service against the
 * person it was protecting.
 */
export async function checkInstallerLimits(
  ip: string,
  token: string | null,
  pathname: string = "",
): Promise<InstallerLimitOutcome> {
  const ceiling = await rateLimit(`installer:ip:${ip}`, INSTALLER_IP_CEILING.max, INSTALLER_IP_CEILING.windowSeconds)
  if (!ceiling.allowed) {
    return { limited: true, result: ceiling, max: INSTALLER_IP_CEILING.max, bucket: "ip" }
  }

  if (!token && !isCredentialRoute(pathname)) {
    // No credential at all, on a route that should have had one. Nothing
    // legitimate does this in volume: the field app holds a token before it
    // calls anything except the sign-in family, which is excluded above.
    const anon = await rateLimit(`installer:anon:${ip}`, LIMITS.installerAnon.max, LIMITS.installerAnon.windowSeconds)
    return { limited: !anon.allowed, result: anon, max: LIMITS.installerAnon.max, bucket: "anon" }
  }

  if (!token) {
    // A sign-in attempt. The route has its own limits, and they are better than
    // anything this layer could apply -- per address as well as per IP, with a
    // lockout on the account itself. The IP ceiling above still applies.
    return { limited: false, result: ceiling, max: INSTALLER_IP_CEILING.max, bucket: "ip" }
  }

  const id = await tokenBucketId(token)
  const perToken = await rateLimit(`installer:token:${id}`, LIMITS.installerToken.max, LIMITS.installerToken.windowSeconds)
  return { limited: !perToken.allowed, result: perToken, max: LIMITS.installerToken.max, bucket: "token" }
}

/**
 * The gate middleware calls, as a plain function of a Request.
 *
 * Returns a 429 to send back, or null to carry on.
 *
 * Separated from middleware.ts so it can be driven directly by a test. The only
 * way to prove a rate limiter over HTTP is to send enough traffic to trip it,
 * and there is nowhere good to send that traffic: against production it is a
 * denial of service on paying customers, and against a dev server it proves
 * that a dev server was running. This is the same code the edge runs, callable
 * from a spec.
 */
export async function installerGate(request: Request): Promise<Response | null> {
  const outcome = await checkInstallerLimits(
    getClientIp(request),
    bearerToken(request.headers),
    new URL(request.url).pathname,
  )
  if (!outcome.limited) return null
  return rateLimitedResponse(
    outcome.result,
    outcome.max,
    "Too many requests from this device. Wait a moment and try again.",
  )
}
