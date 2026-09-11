import { test, expect } from "@playwright/test"
import { login } from "./helpers"

/**
 * Free-tier onboarding: the invite link a supervisor shares, and the join page
 * a worker lands on.
 *
 * This is the path that decides whether a free account ever has anyone on it,
 * so the assertions are about the two ways it can silently fail: a link that
 * does not resolve to a company, and a join page that accepts a bad token.
 *
 * It deliberately does NOT complete a join against the live tenant -- that
 * would add a real worker to a real company on every run. The POST is covered
 * by its refusal cases; the happy path is exercised by hand.
 */
test.describe("free onboarding", () => {
  test("an admin can mint a worker invite link", async ({ page }) => {
    test.setTimeout(120_000)
    await login(page)

    const res = await page.request.get("/api/admin/invite-link")
    expect(res.ok(), `invite-link failed: ${await res.text()}`).toBeTruthy()
    const body = await res.json()

    expect(body.url, "an invite URL").toBeTruthy()
    expect(body.url).toContain("/join/")
    expect(body.companyName, "the link names the company it joins").toBeTruthy()

    // The token half must resolve back to that same company, which is the
    // whole contract between the two endpoints.
    const token = String(body.url).split("/join/")[1]
    const lookup = await page.request.get(`/api/join?token=${encodeURIComponent(token)}`)
    expect(lookup.ok()).toBeTruthy()
    expect((await lookup.json()).companyName).toBe(body.companyName)
  })

  test("the join page renders for a valid link and refuses a bad one", async ({ page }) => {
    test.setTimeout(120_000)
    await login(page)
    const res = await page.request.get("/api/admin/invite-link")
    const { url, companyName } = await res.json()

    // The endpoint returns an absolute URL because the link is meant to be
    // pasted into a chat. Navigate by path so the test stays on whichever host
    // it was pointed at rather than jumping to production.
    await page.goto(new URL(url).pathname)
    await expect(page.getByRole("heading", { name: `Join ${companyName}` })).toBeVisible()
    await expect(page.getByPlaceholder("Dan Whitmore")).toBeVisible()

    await page.goto("/join/not-a-real-token")
    await expect(page.getByRole("heading", { name: "This link will not work" })).toBeVisible()
  })

  test("joining is refused without a valid token or a name", async ({ page }) => {
    await login(page)

    const badToken = await page.request.post("/api/join", {
      data: { token: "not-a-real-token", name: "Someone" },
    })
    expect(badToken.status(), "a forged token must not create a worker").toBe(401)

    const { url } = await (await page.request.get("/api/admin/invite-link")).json()
    const token = String(url).split("/join/")[1]
    const noName = await page.request.post("/api/join", { data: { token, name: " " } })
    expect(noName.status()).toBe(400)
  })

  test("the retention sweep refuses an unauthenticated caller", async ({ page }) => {
    const res = await page.request.get("/api/cron/free-retention")
    expect(res.status(), "the cron must not be runnable by anyone who finds it").toBe(401)
  })
})
