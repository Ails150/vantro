import { test, expect } from "@playwright/test"
import {
  login,
  openTab,
  findJobIdByName,
  purgeE2EJobs,
  ALLOWED_COMPANY,
  E2E_PREFIX,
} from "./helpers"

/**
 * Smoke suite: the four paths that must never be broken by a deploy.
 *
 * This runs against a live tenant, so the one spec that writes data names its
 * job with the e2e- prefix, refuses to run at all if the logged-in company is
 * not the one the suite is pinned to, and has its cleanup in afterEach rather
 * than a finally block, so a failed assertion still tidies up.
 */

test.describe("smoke", () => {
  // Runs after every test, including failures and timeouts. The previous
  // finally-block cleanup depended on a lookup that always returned null, so
  // nothing was ever removed and the tenant collected a job per run.
  test.afterEach(async ({ page }) => {
    const cleared = await purgeE2EJobs(page)
    if (cleared > 0) console.log(`[cleanup] archived ${cleared} e2e job(s)`)
  })

  test("an admin can log in and reach the dashboard", async ({ page }) => {
    await login(page)

    // The nav landed on Today, which is the default admin view. Targeted by id:
    // the sidebar has a zone header and a tab both labelled "Today".
    await expect(page.getByTestId("nav-overview")).toHaveAttribute("aria-current", "page")
    // The panel's own title is "Overview"; only the nav entry reads "Today".
    // Pinned to level 1 and exact, because an unanchored "Today" also matches
    // the "Needs you today" and "Hours today" section headings.
    await expect(
      page.getByRole("heading", { level: 1, name: "Overview", exact: true }),
    ).toBeVisible()
  })

  test("an admin can create a job", async ({ page }) => {
    await login(page)

    // Guard: never write into a company this suite is not meant to touch.
    const company = await page.request.get("/api/admin/company")
    if (company.ok()) {
      const body = await company.json()
      const name: string = body?.company?.name ?? body?.name ?? ""
      expect(
        name,
        `refusing to create data: logged into "${name}", expected ${ALLOWED_COMPANY}`,
      ).toContain(ALLOWED_COMPANY)
    }

    const jobName = `${E2E_PREFIX}smoke-${Date.now()}`

    await openTab(page, "jobs")
    await page.getByTestId("job-add").click()

    await page.getByTestId("job-name").fill(jobName)
    // The address field needs a Google Places selection, which a test cannot
    // drive. The coordinate paste field is the supported non-Places path and
    // sets the same lat/lng the form validates on.
    await page.getByTestId("job-coords").fill("51.857805,-4.300307")

    await page.getByTestId("job-save").click()

    await expect(page.getByText(jobName)).toBeVisible({ timeout: 30_000 })

    // Read back through the endpoint the dashboard itself uses. The job is only
    // really created once it survives a round trip to the database.
    const jobId = await findJobIdByName(page, jobName)
    expect(jobId, "created job should be readable back from the admin jobs API").toBeTruthy()
  })

  test("an admin can generate an audit pack", async ({ page }) => {
    // The config's 60s per-test ceiling would abort before the expect below
    // could use its own budget, so raise the test's own timeout past it.
    test.setTimeout(240_000)
    await login(page)
    await openTab(page, "audit")

    const select = page.getByTestId("audit-job")
    await expect(select).toBeVisible()

    // Pick the first real job. A company with no jobs cannot produce a pack,
    // and that is a fixture problem rather than a regression, so say so.
    const options = await select.locator("option").all()
    const firstJob = options[1]
    test.skip(!firstJob, "no jobs in this company to build an audit pack from")
    await select.selectOption({ index: 1 })

    await page.getByTestId("audit-generate").click()

    // The pack opens on the Daily view, and the signed identity block only
    // renders under Compliance. The old assertion waited on footer copy from
    // that same block without ever switching to it, which is why it timed out
    // rather than failing fast: the content was never going to appear.
    await page.getByRole("button", { name: "Compliance", exact: true }).click()

    // Assert on the pack reference, not the footer copy. The reference is the
    // signed identity of the pack (integrity.reference, VTR-YYYYMMDD-XXXXXXXX)
    // and is what a client quotes at getvantro.com/verify, so it is the part
    // that must not silently stop rendering. Footer wording is presentation and
    // was rewritten twice already.
    //
    // 180s because generation is AI-backed and unbounded on a large job. A cold
    // pack measured 9.5s and a warm one 1.2s against this tenant, so the ceiling
    // is headroom for a slow day rather than an expected wait.
    await expect(page.getByText(/VTR-\d{8}-[A-Z0-9]+/)).toBeVisible({ timeout: 180_000 })
  })

  test("the billing page loads", async ({ page }) => {
    await login(page)
    const res = await page.goto("/billing")
    expect(res?.status(), "billing should not error").toBeLessThan(400)
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
  })
})
