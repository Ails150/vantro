// This file configures the initialization of Sentry for edge features (middleware, edge routes, and so on).
// The config you add here will be used whenever one of the edge features is loaded.
// Note that this config is unrelated to the Vercel Edge Runtime and is also required when running locally.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { SENTRY_RELEASE, SENTRY_ENVIRONMENT } from "@/lib/sentry-release";
import { scrubBreadcrumb, scrubEvent } from "@/lib/sentry-scrub";

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

  // OFF. It was true, which is the setting that sends request headers -- and on
  // this product that means the Cookie header carrying a complete working
  // Supabase session, and the Authorization header carrying a ninety-day field
  // token. With tracesSampleRate at 1 that was not limited to crashes: every
  // request produced a transaction and every transaction carried them.
  sendDefaultPii: false,

  // Belt and braces. sendDefaultPii: false is a promise the SDK makes; these
  // are checks we make, in a module with its own tests, because a scrubbing
  // rule that lives only inside Sentry.init() is one nobody can prove.
  beforeSend: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,
});
