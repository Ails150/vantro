import { test, expect } from "@playwright/test"
import { login } from "./helpers"

/**
 * The admin dashboard must hydrate without React re-rendering the tree.
 *
 * This exists because of one bug and guards a whole class of them: the Recent
 * activity row formatted its timestamp with the ambient locale, so the server
 * sent "17:20" and a US-English browser rendered "05:20 PM", and React threw
 * the server HTML away on every load. Formatting is now pinned in
 * lib/format-time; a hydration error here means something started reading the
 * environment again -- a locale, a time zone, Date.now() in render.
 *
 * Asserts on hydration errors only. Other console noise (a failed analytics
 * beacon, an extension) is not this test's business.
 */
test("the admin dashboard hydrates without a mismatch", async ({ page }) => {
  test.setTimeout(120_000)

  const errors: string[] = []
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text())
  })
  page.on("pageerror", (e) => errors.push(e.message))

  await login(page)
  // Hydration errors surface just after the client bundle takes over, which is
  // later than the shell becoming visible.
  await page.waitForTimeout(4_000)

  const hydration = errors.filter((e) => /hydrat/i.test(e))
  expect(hydration, hydration.join("\n\n")).toEqual([])
})
