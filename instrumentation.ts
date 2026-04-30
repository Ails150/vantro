/**
 * Next.js 16 instrumentation hook.
 * Loads the right Sentry config depending on which runtime is starting.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config")
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config")
  }
}

export const onRequestError = (await import("@sentry/nextjs")).captureRequestError
