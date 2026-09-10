/**
 * The release identifier every Sentry runtime tags events with.
 *
 * One value shared by the server, edge and browser inits and by the source map
 * upload in next.config.ts. If these disagree, Sentry stores the maps under one
 * release and the events under another, and every stack trace stays minified —
 * which is the usual reason "we have source maps" and "traces are unreadable"
 * are true at the same time. Import this rather than re-deriving it.
 *
 * On Vercel the commit SHA is the natural release: it is what the deploy is
 * built from, so it also lets Sentry link an issue back to the commit that
 * introduced it. NEXT_PUBLIC_SENTRY_RELEASE is inlined at build time by
 * next.config.ts so the browser bundle carries the same string.
 */

const sha =
  process.env.NEXT_PUBLIC_SENTRY_RELEASE ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  ''

/** e.g. "vantro@9f2c1ab" in production, "vantro@dev" when running locally. */
export const SENTRY_RELEASE = `vantro@${sha ? sha.slice(0, 7) : 'dev'}`

/**
 * Which deployment produced the event. Vercel sets VERCEL_ENV to production,
 * preview or development; local dev has neither and falls back to development.
 */
export const SENTRY_ENVIRONMENT =
  process.env.NEXT_PUBLIC_VERCEL_ENV ||
  process.env.VERCEL_ENV ||
  process.env.NODE_ENV ||
  'development'
