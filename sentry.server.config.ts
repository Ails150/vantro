/**
 * Sentry server-side configuration.
 * Captures errors thrown in Next.js API routes (e.g. /api/audit, /api/diary).
 * THIS IS THE IMPORTANT ONE — silent server failures (like the Patch 2
 * empty-array bug) would have surfaced here.
 */
import * as Sentry from "@sentry/nextjs"

Sentry.init({
  dsn: process.env.SENTRY_DSN || "https://0ef462651282026eba9b7bfa59111004@o4511309963591680.ingest.de.sentry.io/4511309977813072",
  tracesSampleRate: 0,
  enabled: process.env.NODE_ENV === "production",
})
