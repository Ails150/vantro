import { createServiceClient } from "@/lib/supabase/server"

/**
 * Check whether a key has hit its limit, and record the new hit if not.
 * Backed by Supabase rate_limit_hits table.
 *
 * @param key  Unique key (e.g. "reset-pin:email:foo@bar.com" or "signup:ip:1.2.3.4")
 * @param maxHits  How many hits allowed in the window
 * @param windowSeconds  Window length in seconds
 * @returns true if allowed (and recorded), false if over limit
 */
export async function checkRateLimit(
  key: string,
  maxHits: number,
  windowSeconds: number,
): Promise<boolean> {
  const service = await createServiceClient()
  const windowStart = new Date(Date.now() - windowSeconds * 1000).toISOString()

  const { count } = await service
    .from("rate_limit_hits")
    .select("id", { count: "exact", head: true })
    .eq("key", key)
    .gte("hit_at", windowStart)

  if ((count ?? 0) >= maxHits) {
    console.log("[rate-limit] BLOCKED", { key, count, maxHits, windowSeconds })
    return false
  }

  await service.from("rate_limit_hits").insert({ key })
  return true
}

/**
 * Extract a client IP from a Next.js request.
 * Falls back to a placeholder if not present (e.g. in dev).
 */
export function getClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for")
  if (xff) return xff.split(",")[0].trim()
  const real = request.headers.get("x-real-ip")
  if (real) return real.trim()
  return "unknown"
}
