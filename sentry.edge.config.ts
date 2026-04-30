/**
 * Sentry edge runtime configuration.
 * Captures errors in middleware and edge routes.
 */
import * as Sentry from "@sentry/nextjs"

Sentry.init({
  dsn: process.env.SENTRY_DSN || "https://0ef462651282026eba9b7bfa59111004@o4511309963591680.ingest.de.sentry.io/4511309977813072",
  tracesSampleRate: 0,
  enabled: process.env.NODE_ENV === "production",
})
