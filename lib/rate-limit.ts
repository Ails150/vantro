// lib/rate-limit.ts
//
// One rate limiter, usable from a route handler and from middleware.
//
// WHY IT TALKS TO POSTGREST OVER fetch RATHER THAN USING THE SUPABASE CLIENT.
// Middleware runs in the edge runtime, where `cookies()` and the server client
// built on it do not exist. Rate limiting belongs in middleware -- it is the
// only place that can cover every installer route at once without editing
// thirty files and hoping nobody adds a thirty-first -- so the limiter has to
// work there. A bare fetch to the RPC endpoint works in both runtimes and is
// one round trip either way.
//
// THE CHECK IS ATOMIC. It used to be a count followed by an insert, which meant
// ten concurrent attempts against a limit of three all read zero and all
// proceeded. The limit held against a human and dissolved against a script,
// which is the only caller that matters. check_rate_limit() does both under one
// lock. See 20260916160000_rate_limit_atomic.sql.
//
// IT FAILS OPEN, and that is deliberate and the opposite of the field token
// check. A limiter that cannot reach the database and therefore refuses every
// request has turned a database blip into a total outage -- it has performed
// the denial of service it exists to prevent. Every failure is reported to
// Sentry, because a limiter that is silently not limiting is the thing you most
// want to know about.

export type RateLimitResult = {
  allowed: boolean
  /** Hits in the current window, including this one when allowed. */
  hits: number
  /** Seconds until a slot frees up. 0 when allowed. */
  retryAfter: number
  /** True when the check itself failed and the request was let through. */
  degraded?: boolean
}

/** Report to Sentry if it is loaded, and to the log either way. */
async function report(level: "warning" | "error", message: string, extra: Record<string, unknown>) {
  try {
    // Imported lazily. Pulling @sentry/nextjs in at module scope would drag it
    // into the edge bundle for every request that never trips a limit.
    const Sentry: any = await import("@sentry/nextjs").catch(() => null)
    if (Sentry?.captureMessage) {
      Sentry.captureMessage(message, { level, extra })
      return
    }
  } catch { /* Sentry is a diagnostic, never a dependency of the decision */ }
  if (level === "error") console.error(message, extra)
  else console.warn(message, extra)
}

/**
 * Check a key against its limit, recording the hit if it is allowed.
 *
 * @param key            e.g. "installer:token:<userId>" or "signup:ip:1.2.3.4"
 * @param maxHits        how many are allowed in the window
 * @param windowSeconds  the window length
 */
export async function rateLimit(
  key: string,
  maxHits: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    await report("error", "[rate-limit] not configured; requests are unlimited", { key })
    return { allowed: true, hits: 0, retryAfter: 0, degraded: true }
  }

  try {
    const res = await fetch(`${url}/rest/v1/rpc/check_rate_limit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        p_key: key,
        p_max_hits: maxHits,
        p_window_seconds: windowSeconds,
      }),
      // Longer than the SQL function's own 1s lock_timeout, deliberately.
      //
      // The function serialises callers per key, so a burst on one key queues.
      // If the client abort fires first, the wrapper fails OPEN and a flood
      // gets through unlimited -- the limiter failing at exactly the moment it
      // is needed. Letting the database be the one to give up means contention
      // comes back as a refusal instead. Three seconds is the ceiling on how
      // slow the limiter is allowed to make a request.
      signal: AbortSignal.timeout(3000),
    })

    if (!res.ok) {
      await report("error", "[rate-limit] check failed; allowing request", {
        key, status: res.status, body: (await res.text()).slice(0, 200),
      })
      return { allowed: true, hits: 0, retryAfter: 0, degraded: true }
    }

    const rows = await res.json()
    const row = Array.isArray(rows) ? rows[0] : rows
    if (!row || typeof row.allowed !== "boolean") {
      await report("error", "[rate-limit] unexpected response; allowing request", { key, rows })
      return { allowed: true, hits: 0, retryAfter: 0, degraded: true }
    }

    if (!row.allowed) {
      // A tripped limit is a signal, not noise: it is either an attack or a
      // client stuck in a loop, and both want looking at.
      await report("warning", "[rate-limit] blocked", {
        key: redactKey(key), hits: row.hits, maxHits, windowSeconds,
      })
    }

    return {
      allowed: row.allowed,
      hits: Number(row.hits) || 0,
      retryAfter: Number(row.retry_after_seconds) || 0,
    }
  } catch (err: any) {
    await report("error", "[rate-limit] check threw; allowing request", {
      key, error: err?.message || String(err),
    })
    return { allowed: true, hits: 0, retryAfter: 0, degraded: true }
  }
}

/**
 * The old boolean signature, so the fifteen existing call sites keep working.
 *
 * Kept rather than mass-edited: changing them all in the same commit that
 * changes the mechanism underneath them would make a regression impossible to
 * bisect.
 */
export async function checkRateLimit(
  key: string,
  maxHits: number,
  windowSeconds: number,
): Promise<boolean> {
  return (await rateLimit(key, maxHits, windowSeconds)).allowed
}

/**
 * Keys carry identifiers. An email address in a Sentry message is personal data
 * we did not need to send, and a token fragment is a credential. Both are
 * reduced to their shape before they leave the process.
 */
export function redactKey(key: string): string {
  const [bucket, kind, ...rest] = key.split(":")
  const value = rest.join(":")
  if (!kind) return bucket
  if (kind === "ip") return `${bucket}:ip:${value}` // an IP is the thing being blocked
  if (kind === "email") {
    const at = value.indexOf("@")
    return at > 0 ? `${bucket}:email:***${value.slice(at)}` : `${bucket}:email:***`
  }
  return `${bucket}:${kind}:${value.slice(0, 8)}…`
}

/** Extract a client IP from a request. */
export function getClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for")
  if (xff) return xff.split(",")[0].trim()
  const real = request.headers.get("x-real-ip")
  if (real) return real.trim()
  return "unknown"
}

/**
 * The 429.
 *
 * Retry-After is the point: without it a client that is looping has no idea how
 * long to wait, and the usual response is to retry immediately and stay
 * blocked. The RateLimit-* headers are the draft IETF spelling, which is what
 * most HTTP clients now look for.
 */
export function rateLimitedResponse(
  result: RateLimitResult,
  maxHits: number,
  message = "Too many requests. Please wait and try again.",
): Response {
  const retryAfter = Math.max(1, result.retryAfter || 1)
  return new Response(JSON.stringify({ error: message, retryAfter }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(retryAfter),
      "RateLimit-Limit": String(maxHits),
      "RateLimit-Remaining": "0",
      "RateLimit-Reset": String(retryAfter),
    },
  })
}

// ---------------------------------------------------------------------------
// The limits themselves
// ---------------------------------------------------------------------------
//
// Gathered here rather than scattered through route files so that the whole
// policy can be read at once, and so that a new unauthenticated route has an
// obvious number to reach for instead of inventing one.
//
// They are sized against what the product actually does, not against a round
// number. The installer limit is the one worth explaining: a worker's phone
// signs in, loads jobs, posts a location, uploads a photograph and polls. Sixty
// requests a minute is roughly ten times a busy minute of that, which leaves a
// flaky-network retry loop unbothered and still stops a stolen token being used
// to walk a company's history.

export const LIMITS = {
  /** Per field token. Covers every /api/installer/* route at once. */
  installerToken: { max: 60, windowSeconds: 60 },
  /** Installer traffic with no token at all, by IP. Much tighter. */
  installerAnon: { max: 20, windowSeconds: 60 },
  /** Accepting an invite. A worker does this once. */
  invite: { max: 10, windowSeconds: 3600 },
  /** Signature-authenticated webhooks, by IP. Generous: Stripe retries. */
  webhook: { max: 300, windowSeconds: 60 },
  /** A webhook whose signature did NOT verify. Nothing legitimate does this. */
  webhookBadSignature: { max: 10, windowSeconds: 3600 },
  /** Inbound support provisioning, which carries a shared secret. */
  supportProvision: { max: 10, windowSeconds: 3600 },
} as const
