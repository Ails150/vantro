// lib/safe-redirect.ts
//
// Where a `?next=` parameter is allowed to send somebody.
//
// THE BUG THIS EXISTS FOR. The auth callback did this:
//
//     return NextResponse.redirect(`${origin}${next}`)
//
// which looks safe, because the attacker only controls the tail and the origin
// is ours. It is not. `@` in a URL separates userinfo from the host, so
//
//     next = "@evil.example.com"
//     -> https://app.getvantro.com@evil.example.com/
//
// is a URL whose host is evil.example.com and whose USERNAME is
// app.getvantro.com. Confirmed against production: a real magic-link token with
// that next returned 307 to exactly that address.
//
// What makes it worse than an ordinary open redirect is where it sits. The link
// is a genuine Vantro sign-in link, sent by us, to the right person, with a
// valid token. It signs them in and then delivers them to an attacker's page --
// and the URL they clicked is unimpeachably ours. There is nothing for anybody
// to notice.
//
// The 2FA verify screen had the milder version of the same thing: it accepted
// any `next` that started with "/", which admits "//evil.example.com" -- a
// protocol-relative URL that browsers resolve to another host entirely.
//
// PREFIX CHECKS ARE THE WRONG TOOL. startsWith("/") misses "//". Also rejecting
// "//" misses "/\" and "/%5c", which some browsers normalise to "//". The only
// reliable test is to resolve the candidate the way the browser will and then
// look at where it actually points.

/** Where somebody goes when `next` is missing or unusable. */
export const DEFAULT_NEXT = "/admin"

/**
 * Reduce a `?next=` value to a safe same-origin path.
 *
 * Returns a path beginning with a single "/", or the fallback. Never returns
 * anything that could resolve to another host, and never returns an absolute
 * URL even for our own origin -- a relative path cannot be turned into a
 * cross-origin one by a later concatenation.
 */
export function safeNextPath(
  next: string | null | undefined,
  fallback: string = DEFAULT_NEXT,
): string {
  if (typeof next !== "string" || next.length === 0) return fallback

  // Resolve against a base that is deliberately NOT our real origin. If the
  // result has drifted off this base, the value pointed somewhere else and it
  // does not matter where.
  const BASE = "https://vantro.invalid"
  let url: URL
  try {
    url = new URL(next, BASE)
  } catch {
    return fallback
  }

  if (url.origin !== BASE) return fallback
  // Userinfo cannot survive same-origin resolution, but a value that carried it
  // is somebody probing rather than a stray path, and it costs nothing to say
  // no twice.
  if (url.username || url.password) return fallback
  // A backslash is a path separator to some browsers and not to URL(), which is
  // exactly the disagreement an attacker needs.
  if (/[\\]/.test(next)) return fallback
  if (next.includes("://")) return fallback

  const path = `${url.pathname}${url.search}${url.hash}`
  if (!path.startsWith("/") || path.startsWith("//")) return fallback
  return path
}
