import { withSentryConfig } from "@sentry/nextjs"
import type { NextConfig } from "next";

/**
 * The release this build is tagged with. Resolved once, here, and handed to
 * both the browser bundle (via env, so lib/sentry-release.ts can read it at
 * runtime) and the Sentry source map upload below. Both sides must agree or
 * traces stay minified.
 */
const commitSha = process.env.VERCEL_GIT_COMMIT_SHA || ""
const sentryRelease = `vantro@${commitSha ? commitSha.slice(0, 7) : "dev"}`

const nextConfig: NextConfig = {
  reactCompiler: true,
  env: {
    // Inlined at build time so the client bundle carries the same release
    // string the server and the uploaded source maps use.
    NEXT_PUBLIC_SENTRY_RELEASE: commitSha,
  },
};

const __sentry_original_config = nextConfig;


export default withSentryConfig(__sentry_original_config, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "scale-8",

  project: "vantro",

  // Upload source maps under the same release the runtime tags events with,
  // and tell Sentry which commit built it so an issue can be traced to a diff.
  release: {
    name: sentryRelease,
    // ignoreMissing keeps a deploy from failing the build if the repo is not
    // linked in Sentry yet — commit association is a nice-to-have, not a gate.
    setCommits: commitSha
      ? { repo: "Ails150/vantro", commit: commitSha, auto: false, ignoreMissing: true }
      : undefined,
  },

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  }
});
