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

/**
 * Prefix for anything this suite creates.
 *
 * Lower case and hyphenated so it cannot be confused with a real job name, and
 * so cleanup can find strays from a run that died before its own teardown.
 */
export const E2E_PREFIX = "e2e-"

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

/**
 * Move to a tab by its id.
 *
 * Was by accessible name, which broke the moment the sidebar grew collapsible
 * zone headers: "Today" is both a zone and a tab, so the locator matched two
 * elements and failed strict mode. Ids are unique and are already the thing
 * everything else keys on.
 */
export async function openTab(page: Page, tabId: string): Promise<void> {
  await page.getByTestId(`nav-${tabId}`).click()
}

/**
 * Archive a job, which is what the dashboard's own Archive button does.
 *
 * Not /api/jobs/delete: that one requires role exactly "admin" and answers 401
 * to the superadmin this suite signs in as, so every previous cleanup failed
 * silently and left its job behind. Archive accepts admin and superadmin, and
 * an archived job drops out of /api/admin/jobs, so it stops being litter.
 */
export async function archiveJob(page: Page, jobId: string): Promise<void> {
  const res = await page.request.post("/api/jobs/archive", { data: { jobId } })
  if (!res.ok()) {
    throw new Error(`cleanup failed for job ${jobId}: ${res.status()} ${await res.text()}`)
  }
}

/** Every job the admin dashboard can see, from the endpoint it uses itself. */
export async function listAdminJobs(page: Page): Promise<any[]> {
  const res = await page.request.get("/api/admin/jobs")
  if (!res.ok()) {
    throw new Error(`GET /api/admin/jobs failed: ${res.status()} ${await res.text()}`)
  }
  const body = await res.json()
  return body.jobs ?? []
}

/**
 * Find a job id by name.
 *
 * Was GET /api/jobs, which forwards to the installer route behind
 * verifyFieldToken. A browser session can never satisfy a field token, so this
 * returned null on every run and the assertion that used it could not pass.
 */
export async function findJobIdByName(page: Page, name: string): Promise<string | null> {
  const jobs = await listAdminJobs(page)
  return jobs.find((j: any) => j?.name === name)?.id ?? null
}

/**
 * Archive anything this suite left behind, including from earlier runs.
 * Returns how many it cleared, so teardown can say so rather than go quiet.
 */
export async function purgeE2EJobs(page: Page): Promise<number> {
  let jobs: any[]
  try {
    jobs = await listAdminJobs(page)
  } catch {
    return 0 // never fail teardown on a listing error
  }
  const strays = jobs.filter((j: any) =>
    String(j?.name ?? "").toLowerCase().startsWith(E2E_PREFIX),
  )
  let cleared = 0
  for (const j of strays) {
    try {
      await archiveJob(page, j.id)
      cleared++
    } catch {
      // Leave it: reporting a teardown failure would mask the real assertion.
    }
  }
  return cleared
}
