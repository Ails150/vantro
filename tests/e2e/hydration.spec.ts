import { test, expect } from "@playwright/test"
import { login } from "./helpers"

/**
 * The admin dashboard must hydrate without React re-rendering the tree.
 *
 * Two production bugs of exactly this shape in two days, both of them a value
 * that differed between the server render and the client one:
 *
 *   - 14b5477825cf4150b698b6f32b5732d6: Recent activity formatted its
 *     timestamp with the ambient locale, so the server sent "17:20" and a
 *     US-English browser rendered "05:20 PM". Fixed by pinning locale and zone
 *     in lib/format-time.
 *   - e4a10aa82ed64f15b4fb996e02e3a194: LateNote computed minsLate from
 *     Date.now() on both sides of the boundary, so the two renders differed by
 *     the travel time of the request. Fixed by stamping the clock once on the
 *     server and passing it down -- see components/ui/useNow.
 *
 * Both classes come back the same way: something in render reads the
 * environment instead of a prop. So this runs over the tabs that show relative
 * times, not just the default one, because the first version of this test only
 * covered Overview and the second bug was on Overview's own table.
 *
 * Asserts on hydration errors only. Other console noise -- a dead Cloudflare
 * Stream embed in the diary, a failed analytics beacon -- is not its business.
 */
const TIME_BEARING_TABS = [
  "overview", // lateness, shift duration, oldest QA age
  "alerts", // alert age filters
  "diary", // entry recency
  "approvals", // submitted-at stamps
]

test("the admin dashboard hydrates without a mismatch", async ({ page }) => {
  test.setTimeout(300_000)
  await login(page)

  for (const tab of TIME_BEARING_TABS) {
    const errors: string[] = []
    const onConsole = (m: any) => { if (m.type() === "error") errors.push(m.text()) }
    const onPageError = (e: Error) => errors.push(e.message)
    page.on("console", onConsole)
    page.on("pageerror", onPageError)

    await page.goto(`/admin?tab=${tab}`)
    // Hydration errors surface just after the client bundle takes over, which
    // is later than the shell becoming visible.
    await page.waitForTimeout(4_000)

    page.off("console", onConsole)
    page.off("pageerror", onPageError)

    const hydration = errors.filter((e) => /hydrat/i.test(e))
    expect(hydration, `${tab}:\n${hydration.join("\n\n")}`).toEqual([])
  }
})
