// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { SENTRY_RELEASE, SENTRY_ENVIRONMENT } from "@/lib/sentry-release";

Sentry.init({
  dsn: "https://7252288369772967b46c6352eae1860c@o4511309963591680.ingest.de.sentry.io/4511310010253392",

  // Tag every event with the commit this deploy was built from, so an
  // issue points at a release and source maps resolve. See lib/sentry-release.ts.
  release: SENTRY_RELEASE,
  environment: SENTRY_ENVIRONMENT,

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: 1,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Enable sending user PII (Personally Identifiable Information)
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: true,
});
