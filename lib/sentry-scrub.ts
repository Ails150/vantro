// lib/sentry-scrub.ts
//
// What must never reach Sentry from the web app.
//
// THE LEAK. All four Sentry configs -- server, edge, client and the mobile
// app's -- shipped with `sendDefaultPii: true`, which is the setting that sends
// request headers. On this product that means:
//
//   - The COOKIE header on every admin request, carrying
//     sb-<project-ref>-auth-token: a complete, working Supabase session. Anyone
//     with read access to the error tracker could sign in as that administrator.
//   - The AUTHORIZATION header on every field-app request, carrying a bearer
//     token good for up to ninety days against a company's real site data.
//
// tracesSampleRate was 1, so this was not limited to crashes. Every request
// produced a transaction, and every transaction carried the headers.
//
// The edge config is the one worth calling out separately: it initialises
// Sentry for MIDDLEWARE, which runs on every single request in the product,
// authenticated or not.
//
// The mobile half of this was fixed in the app repo. This is the same work for
// the web, deliberately written as a separate module with its own tests rather
// than as a closure inside a config object -- a scrubbing rule that lives only
// inside Sentry.init() is one nobody can prove.

export const REDACTED = "[redacted]"

/** A JWT: three base64url segments. Supabase sessions and field tokens both. */
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g

/** A bearer credential, keeping the word so the log still reads sensibly. */
const BEARER_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi

/** A Supabase auth cookie, in any of the shapes it is written in. */
const SB_COOKIE_RE = /sb-[a-z0-9]+-auth-token(\.\d+)?=[^;\s]+/gi

/** Headers that are a credential by definition, whatever their value. */
const SECRET_HEADERS = new Set([
  "authorization", "cookie", "set-cookie", "x-api-key", "apikey",
  "x-bootstrap-secret", "stripe-signature", "x-cron-secret", "x-supabase-auth",
])

/**
 * Keys whose VALUE is never worth sending.
 *
 * Location is in the list and is not an afterthought: a workforce product that
 * leaks where somebody was standing has failed at the one thing its users did
 * not choose to share.
 */
const SECRET_KEYS = [
  "token", "access_token", "refresh_token", "id_token", "jwt", "bearer",
  "password", "pin", "pin_hash", "secret", "api_key", "apikey", "authorization",
  "cookie", "session", "service_role", "anon_key", "signature",
  "lat", "lng", "latitude", "longitude", "coords", "location",
]

function isSecretKey(key: string): boolean {
  const k = key.toLowerCase()
  return SECRET_KEYS.some(s => k === s || k.endsWith(`_${s}`) || k.includes(s))
}

/** Remove credentials from anywhere inside a string. */
export function scrubString(value: string): string {
  if (typeof value !== "string" || value.length === 0) return value
  let out = value.replace(JWT_RE, REDACTED)
  out = out.replace(BEARER_RE, (_m, scheme) => `${scheme} ${REDACTED}`)
  out = out.replace(SB_COOKIE_RE, `sb-auth-token=${REDACTED}`)
  return out
}

export function scrubHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers) return headers
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    out[key] = SECRET_HEADERS.has(key.toLowerCase())
      ? REDACTED
      : scrubString(String(value))
  }
  return out
}

/** Walk anything, redacting by key name and by value shape. */
export function scrubValue(value: unknown, depth = 0): unknown {
  // Bounded rather than cycle-tracked: a Sentry payload is a tree, and a
  // scrubber that hangs on a deep one takes the process with it.
  if (depth > 12) return REDACTED
  if (value == null) return value
  if (typeof value === "string") return scrubString(value)
  if (typeof value !== "object") return value
  if (Array.isArray(value)) return value.map(v => scrubValue(v, depth + 1))

  const out: Record<string, unknown> = {}
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSecretKey(key) ? REDACTED : scrubValue(inner, depth + 1)
  }
  return out
}

/** A URL with its query string cleaned, since tokens end up there too. */
export function scrubUrl(url: string | undefined): string | undefined {
  if (!url) return url
  try {
    const parsed = new URL(url, "https://app.getvantro.com")
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (isSecretKey(key) || key === "token_hash" || key === "code") {
        parsed.searchParams.set(key, REDACTED)
      }
    }
    // Userinfo is a credential and has no business in a report.
    parsed.username = ""
    parsed.password = ""
    return parsed.toString()
  } catch {
    return scrubString(url)
  }
}

export function scrubBreadcrumb(breadcrumb: any): any {
  if (!breadcrumb) return breadcrumb
  if (breadcrumb.message) breadcrumb.message = scrubString(String(breadcrumb.message))
  if (breadcrumb.data) {
    breadcrumb.data = scrubValue(breadcrumb.data)
    if ((breadcrumb.data as any)?.url) {
      (breadcrumb.data as any).url = scrubUrl(String((breadcrumb.data as any).url))
    }
  }
  return breadcrumb
}

/**
 * The last thing that runs before an event leaves the process.
 *
 * Never throws. A scrubber that throws inside beforeSend drops the event in
 * some SDK versions and sends it unscrubbed in others, and neither is a
 * behaviour to find out about during an incident.
 */
export function scrubEvent(event: any): any {
  if (!event) return event
  try {
    if (event.request) {
      event.request.headers = scrubHeaders(event.request.headers)
      event.request.cookies = event.request.cookies ? REDACTED : event.request.cookies
      if (event.request.url) event.request.url = scrubUrl(event.request.url)
      if (event.request.query_string) {
        event.request.query_string = scrubValue(event.request.query_string)
      }
      if (event.request.data) event.request.data = scrubValue(event.request.data)
    }

    // An email or an IP is not worth the exposure on a product that also knows
    // where people were standing. An id is enough to find the account.
    if (event.user) event.user = event.user.id ? { id: event.user.id } : {}

    if (event.message) event.message = scrubString(String(event.message))
    if (event.extra) event.extra = scrubValue(event.extra)
    if (event.contexts) event.contexts = scrubValue(event.contexts)
    if (Array.isArray(event.breadcrumbs)) {
      event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb)
    }
    if (Array.isArray(event.exception?.values)) {
      for (const value of event.exception.values) {
        if (value?.value) value.value = scrubString(String(value.value))
      }
    }
    return event
  } catch {
    // Cannot scrub it, so do not send it. The opposite of the usual fail-open:
    // a lost error report costs a debugging session, and a leaked session
    // cookie costs a customer.
    return null
  }
}
