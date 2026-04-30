/**
 * Sentry browser-side configuration.
 * Captures uncaught exceptions in the React frontend.
 * DSN is embedded — Sentry's standard practice; the DSN is not a secret.
 */
import * as Sentry from "@sentry/nextjs"

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || "https://0ef462651282026eba9b7bfa59111004@o4511309963591680.ingest.de.sentry.io/4511309977813072",
  // Send all errors in production. Throttle if volume gets high.
  tracesSampleRate: 0,            // disable performance tracing for now (free tier)
  replaysSessionSampleRate: 0,    // disable session replay (privacy + cost)
  replaysOnErrorSampleRate: 0,
  // Don't send errors when running locally
  enabled: process.env.NODE_ENV === "production",
})
