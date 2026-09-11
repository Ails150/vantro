"use client"

import * as React from "react"

/**
 * A clock that is safe to render on the server.
 *
 * Any component that says "3h ago", "9h 31m late" or counts down to a shift
 * end reads the current time during render. On a client component that also
 * renders on the server, that happens twice -- once in Node when the request
 * is handled, once in the browser a second or two later -- and React compares
 * the two strings. They differ by exactly the time in between, so the whole
 * tree is thrown away and re-rendered on every load. That is
 * Sentry e4a10aa82ed64f15b4fb996e02e3a194: LateNote computed minsLate from
 * Date.now() on both sides of the boundary.
 *
 * The fix is to make the first render deterministic. `serverNow` is stamped
 * once on the server and passed down as a prop, so server and client agree on
 * the very first paint. Only after hydration does this hook switch to the real
 * clock and start ticking.
 *
 * The one-minute default suits the things this app shows: lateness, shift
 * duration, alert ages. Nothing here counts seconds, and a per-second interval
 * would re-render the dashboard sixty times a minute to move a digit that
 * changes once.
 */
export function useNow(serverNow: number, intervalMs = 60_000): number {
  const [now, setNow] = React.useState(serverNow)

  React.useEffect(() => {
    // Correct to the real clock immediately after hydration. This runs after
    // React has matched the server HTML, so it cannot cause a mismatch -- it
    // is a normal state update, and by now the page is interactive anyway.
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])

  return now
}

export default useNow
