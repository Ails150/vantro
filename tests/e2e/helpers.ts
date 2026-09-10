import { expect, type Page } from "@playwright/test"

/**
 * Read a required env var, or fail with the name rather than a confusing
 * downstream error. An empty baseURL otherwise surfaces as "Invalid URL".
 */
export function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.e2e.example to .env.e2e and fill it in.`,
    )
  }
  return value
}

/**
 * The company these tests are allowed to touch.
 *
 * The suite runs against production, so it is pinned to one tenant on purpose.
 * Any spec that writes data asserts this first: a smoke test must never create
 * or delete rows in another customer's company.
 */
export const ALLOWED_COMPANY = "Apexify"

/** Log in through the real form and land on the admin dashboard. */
export async function login(page: Page): Promise<void> {
  await page.goto("/login")
  await page.getByTestId("login-email").fill(required("E2E_ADMIN_EMAIL"))
  await page.getByTestId("login-password").fill(required("E2E_ADMIN_PASSWORD"))
  await page.getByTestId("login-submit").click()

  // The admin shell is the signal that auth succeeded and the dashboard
  // rendered, rather than a URL match that a redirect could satisfy early.
  await expect(page.getByTestId("admin-shell")).toBeVisible({ timeout: 30_000 })
}

/** Move to a tab by its sidebar label. */
export async function openTab(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: label, exact: true }).click()
}

/**
 * Delete a job through the same route the UI uses, so a spec that creates one
 * leaves nothing behind even if its assertions fail. Uses the browser's own
 * session cookies.
 */
export async function deleteJob(page: Page, jobId: string): Promise<void> {
  const res = await page.request.post("/api/jobs/delete", { data: { jobId } })
  if (!res.ok()) {
    throw new Error(`cleanup failed for job ${jobId}: ${res.status()} ${await res.text()}`)
  }
}

/** Find a job id by name via the jobs API, for cleanup. */
export async function findJobIdByName(page: Page, name: string): Promise<string | null> {
  const res = await page.request.get("/api/jobs")
  if (!res.ok()) return null
  const body = await res.json()
  const jobs: any[] = body.jobs ?? body ?? []
  return jobs.find((j: any) => j?.name === name)?.id ?? null
}
