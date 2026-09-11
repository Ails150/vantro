// lib/billing.ts
// What each plan costs and which Stripe price sells it.
//
// Entitlement is NOT decided here. This file knows about money; lib/plan.ts
// knows about features. Keeping them apart is what stops a pricing change from
// silently moving a feature boundary.
//
// The previous model was Starter/Growth/Scale at GBP 299/399/499, gated on
// installer headcount, plus a GBP 79 AI Audit Pack add-on. Headcount pricing
// punished exactly the customers who had rolled the app out widely, and the
// add-on meant compliance features could be on or off independently of the
// tier, which is the ambiguity companies.plan now removes.

import type { Plan } from "./plan"

export type PaidPlan = Exclude<Plan, "free">

export const PLANS = {
  free: {
    name: "Free",
    price: 0,
    /** No Stripe object. A free company never becomes a customer. */
    priceId: null as string | null,
    blurb: "Geofenced sign in and out, and today's board.",
  },
  payroll: {
    name: "Payroll",
    price: 39.99,
    priceId: process.env.STRIPE_PRICE_PAYROLL ?? null,
    blurb: "Verified hours: geofence, QR, full history and payroll export.",
  },
  suite: {
    name: "Suite",
    price: 99,
    priceId: process.env.STRIPE_PRICE_SUITE ?? null,
    blurb: "Everything, plus compliance, defects, QA and audit packs.",
  },
} as const

export const PLAN_ORDER: Plan[] = ["free", "payroll", "suite"]

export function planDetails(plan: Plan) {
  return PLANS[plan]
}

/** Formatted for display. 39.99 keeps its pence, 99 and 0 do not gain any. */
export function formatPrice(price: number): string {
  if (price === 0) return "Free"
  return Number.isInteger(price) ? `£${price}` : `£${price.toFixed(2)}`
}

/** The plan a Stripe price id sells, or null if it is not one of ours. */
export function planForPriceId(priceId: string | null | undefined): PaidPlan | null {
  if (!priceId) return null
  if (PLANS.payroll.priceId && priceId === PLANS.payroll.priceId) return "payroll"
  if (PLANS.suite.priceId && priceId === PLANS.suite.priceId) return "suite"
  return null
}

/**
 * Signup no longer picks a tier from headcount: everyone starts free, with no
 * card, and upgrades when a paid feature is actually wanted.
 */
export const SIGNUP_PLAN: Plan = "free"

export function formatTrialDaysRemaining(trialEndsAt: string): number {
  const end = new Date(trialEndsAt)
  const diff = end.getTime() - Date.now()
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
}
