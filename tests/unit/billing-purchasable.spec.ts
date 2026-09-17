import { test, expect } from "@playwright/test"
import { PLANS, PLAN_ORDER, purchasable } from "../../lib/billing"

/**
 * Whether a plan can actually be bought, and why not when it cannot.
 *
 * Written because it could not, and nobody knew. STRIPE_PRICE_PAYROLL and
 * STRIPE_PRICE_SUITE are not set in production -- the variables that ARE set
 * are STRIPE_PRICE_STARTER, _GROWTH and _SCALE, from the pricing model
 * lib/billing.ts says was replaced. So PLANS.payroll.priceId and
 * PLANS.suite.priceId were both null, and every upgrade and checkout returned
 *
 *     400 { "error": "Invalid plan" }
 *
 * Nobody could pay for Vantro, and the logs read like users clicking the wrong
 * thing. A misconfiguration that reports itself as a client error is a bug that
 * runs for months.
 *
 * This does NOT assert the price ids are set, because they are not set in a
 * test environment either and a test that fails on every developer's machine
 * gets deleted. It asserts the product can TELL THE DIFFERENCE, which is what
 * turns a silent revenue outage into a loud one.
 */

test.describe("purchasable", () => {
  test("free is not buyable, and says so specifically", () => {
    const r = purchasable("free")
    expect(r.ok).toBe(false)
    expect((r as any).reason).toBe("free_plan")
  })

  test("a plan that does not exist is a client error", () => {
    const r = purchasable("enterprise" as any)
    expect(r.ok).toBe(false)
    expect((r as any).reason).toBe("unknown_plan")
  })

  test("a real plan with no price id is OUR error, not the caller's", () => {
    // The distinction the whole module exists for.
    for (const plan of PLAN_ORDER.filter(p => p !== "free")) {
      const r = purchasable(plan)
      if (r.ok) continue // configured in this environment; nothing to assert
      expect((r as any).reason, `${plan} reported as a client error`).toBe("not_configured")
    }
  })

  test("the misconfiguration message names the variable to set", () => {
    // The person reading this log is the person who has to go and set it.
    // "Invalid plan" sent them looking at the request instead.
    const r = purchasable("payroll")
    if (!r.ok && (r as any).reason === "not_configured") {
      expect((r as any).detail).toContain("STRIPE_PRICE_PAYROLL")
    }
  })

  test("every paid plan has a price and a name to charge for", () => {
    // Independent of Stripe: a tier with no price or no name is broken
    // regardless of configuration.
    for (const plan of PLAN_ORDER.filter(p => p !== "free")) {
      expect(PLANS[plan].price, `${plan} costs nothing`).toBeGreaterThan(0)
      expect(PLANS[plan].name).toBeTruthy()
    }
  })

  test("the price variable name matches the plan key", () => {
    // purchasable() builds the variable name from the plan key, so a rename
    // that broke the convention would produce advice pointing at a variable
    // nobody has. Both current paid plans are single words; this is the guard
    // for the day one is not.
    for (const plan of PLAN_ORDER.filter(p => p !== "free")) {
      expect(plan, `plan key "${plan}" would produce a malformed env var name`)
        .toMatch(/^[a-z]+$/)
    }
  })
})
