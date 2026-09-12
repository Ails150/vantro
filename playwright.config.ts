import { defineConfig, devices } from "@playwright/test"
import { config as loadEnv } from "dotenv"

// Credentials live in .env.e2e, which is gitignored. .env.e2e.example lists the
// keys with blank values. Nothing here has a default: a missing variable should
// fail loudly in the spec rather than silently point the suite somewhere else.
loadEnv({ path: ".env.e2e" })

export default defineConfig({
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  expect: { timeout: 15_000 },
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      // Pure logic. No browser, no server, no tenant -- so these run anywhere,
      // including on a machine with no .env.e2e, and they run in parallel.
      // `npx playwright test --project=unit` is the fast gate.
      name: "unit",
      testDir: "./tests/unit",
      fullyParallel: true,
      timeout: 10_000,
      retries: 0,
    },
    {
      // The suite touches a live tenant, so specs must not race each other for
      // the same rows. One worker, in order.
      name: "chromium",
      testDir: "./tests/e2e",
      workers: 1,
      fullyParallel: false,
      timeout: 60_000,
      retries: process.env.CI ? 1 : 0,
      use: { ...devices["Desktop Chrome"], baseURL: process.env.E2E_BASE_URL },
    },
  ],
})
