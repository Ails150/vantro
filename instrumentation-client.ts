// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { SENTRY_RELEASE, SENTRY_ENVIRONMENT } from "@/lib/sentry-release";
import { scrubBreadcrumb, scrubEvent } from "@/lib/sentry-scrub";

Sentry.init({
  dsn: "https://7252288369772967b46c6352eae1860c@o4511309963591680.ingest.de.sentry.io/4511310010253392",

  // Session replay, with masking stated rather than left to defaults.
  //
  // It records 10% of sessions and 100% of sessions with an error, on screens
  // that show worker names, hourly rates, home postcodes on a map, and the
  // exact place somebody stood when they signed in. The SDK's defaults do mask
  // text, but relying on a default for that is how a version bump becomes a
  // disclosure -- and the same argument applied to the mobile app, where the
  // screen in question was a PIN pad.
  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      maskAllInputs: true,
      blockAllMedia: true,
    }),
  ],

  // Tag every event with the commit this deploy was built from, so an
  // issue points at a release and source maps resolve. See lib/sentry-release.ts.
  release: SENTRY_RELEASE,
  environment: SENTRY_ENVIRONMENT,

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: 1,
  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Define how likely Replay events are sampled.
  // This sets the sample rate to be 10%. You may want this to be 100% while
  // in development and sample at a lower rate in production
  replaysSessionSampleRate: 0.1,

  // Define how likely Replay events are sampled when an error occurs.
  replaysOnErrorSampleRate: 1.0,

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

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
