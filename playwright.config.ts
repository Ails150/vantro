import { defineConfig, devices } from "@playwright/test"
import { config as loadEnv } from "dotenv"

// Credentials live in .env.e2e, which is gitignored. .env.e2e.example lists the
// keys with blank values. Nothing here has a default: a missing variable should
// fail loudly in the spec rather than silently point the suite somewhere else.
loadEnv({ path: ".env.e2e" })

export default defineConfig({
  testDir: "./tests/e2e",
  // The suite touches a live tenant, so specs must not race each other for the
  // same rows. One worker, in order.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
})
