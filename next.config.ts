import { withSentryConfig } from "@sentry/nextjs"
import type { NextConfig } from "next";

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://maps.googleapis.com https://cdnjs.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://*.supabase.co https://maps.googleapis.com https://maps.gstatic.com https://*.googleapis.com https://*.ggpht.com https://*.r2.dev https://*.r2.cloudflarestorage.com",
  "connect-src 'self' data: https://*.supabase.co wss://*.supabase.co https://maps.googleapis.com https://www.gstatic.com https://exp.host https://api.anthropic.com https://*.r2.dev",
  "frame-src 'self' https://customer-*.cloudflarestream.com https://iframe.videodelivery.net",
  "media-src 'self' https://*.r2.dev https://*.cloudflarestream.com",
  "worker-src 'self' blob:",
  "frame-ancestors 'self'"
].join("; ");

const nextConfig: NextConfig = {
  reactCompiler: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
        ],
      },
    ];
  },
};

const __sentry_original_config = nextConfig;


export default withSentryConfig(__sentry_original_config, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "scale-8",

  project: "vantro",

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
