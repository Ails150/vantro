"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { PLANS, PLAN_ORDER, formatPrice } from "@/lib/billing"
import { toPlan, atLeast, historyDays, type Plan } from "@/lib/plan"
import { isFieldRole } from "@/lib/roles"
import { PageTransition, PageHeader, Section, Stat } from "@/components/ui/Page"
import { Button } from "@/components/ui/Button"
import { listVariants, itemVariants } from "@/components/ui/motion"

// Billing had no home. The Stripe portal handler had no call site and
// BillingComponents.tsx was imported nowhere at all; the only live surface was
// the trial-expiry PaywallOverlay, which appears when it is already too late.
//
// PaywallOverlay is deliberately NOT opened from here. It takes no onClose, so
// a button that showed it would leave an admin with no way back out. It stays
// the automatic gate the dashboard raises on expiry.

type Props = {
  company: any
  teamMembers: any[]
  onOpenPortal: () => void
}

/** What each plan gets, in the customer's words rather than feature flags. */
const INCLUDES: Record<Plan, string[]> = {
  free: [
    "Sign in and out by hand",
    "Today's board",
    "Invite your team",
    "5 days of history",
  ],
  payroll: [
    "Everything in Free",
    "Geofenced sign in, so hours are verified",
    "QR site and worker codes",
    "Payroll export, expenses and the scheduler",
    "History kept for good",
  ],
  suite: [
    "Everything in Payroll",
    "Signed compliance audit packs",
    "Defects, QA reviews and sign-off",
    "Site diary with AI classification",
    "Subcontractor records",
  ],
}

export default function BillingTab({ company, teamMembers, onOpenPortal }: Props) {
  const [working, setWorking] = React.useState<Plan | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const plan = toPlan(company?.plan)
  const retention = historyDays(plan)

  // Counted the same way the limit is enforced on add, so the figure here and
  // the refusal there cannot disagree.
  const activeWorkers = (teamMembers || []).filter(
    (m: any) => (isFieldRole(m.role) || m.role === "foreman") && m.is_active !== false
  ).length

  async function choose(next: Plan) {
    if (next === plan) return
    setWorking(next)
    setError(null)
    try {
      const res = await fetch("/api/billing/upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPlan: next }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error || "Could not change plan. Try again, or use the billing portal.")
        return
      }
      if (data?.url) {
        window.location.href = data.url
        return
      }
      window.location.reload()
    } catch {
      setError("Could not reach billing. Check your connection and try again.")
    } finally {
      setWorking(null)
    }
  }

  return (
    <PageTransition>
      <PageHeader
        title="Billing"
        description="Your plan, what it covers, and where the invoices live."
        actions={
          plan === "free" ? null : (
            <Button variant="secondary" size="sm" onClick={onOpenPortal}>
              Manage billing
            </Button>
          )
        }
      />

      <div className="grid grid-cols-2 gap-6 border-t border-line pt-6 md:grid-cols-3">
        <Stat
          label="Plan"
          value={PLANS[plan].name}
          hint={plan === "free" ? "No card on file" : `${formatPrice(PLANS[plan].price)}/month`}
        />
        <Stat label="Workers" value={activeWorkers} hint="Active on the app" />
        <Stat
          label="History"
          value={retention === null ? "Kept" : `${retention} days`}
          hint={retention === null ? "No time limit" : "Older shifts are deleted nightly"}
        />
      </div>

      {plan === "free" && (
        <div className="mt-6 rounded-md border border-warn/30 bg-warn-wash p-4">
          <p className="text-sm text-ink">Shifts older than {retention} days are deleted.</p>
          <p className="mt-1 text-xs text-ink-muted">
            On a paid plan nothing is deleted, and sign in can be checked against the site
            boundary rather than taken on trust.
          </p>
        </div>
      )}

      <Section title="Plans" className="mt-8">
        {error && <p className="mb-3 text-sm text-danger">{error}</p>}
        <motion.ul
          initial="hidden"
          animate="visible"
          variants={listVariants}
          className="grid gap-4 md:grid-cols-3"
        >
          {PLAN_ORDER.map((key) => {
            const tier = PLANS[key]
            const isCurrent = key === plan
            // A move down is a real decision with data loss behind it (free
            // deletes history), so it goes through the portal rather than a
            // one-tap button on a card.
            const isDowngrade = !atLeast(key, plan) && !isCurrent
            return (
              <motion.li
                key={key}
                variants={itemVariants}
                className={
                  "rounded-md border p-4 transition-colors duration-fast ease-out " +
                  (isCurrent ? "border-accent bg-accent-wash" : "border-line hover:bg-surface-hover")
                }
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-ink">{tier.name}</p>
                  {isCurrent && (
                    <span className="text-[11px] font-medium text-accent-ink">Current</span>
                  )}
                </div>
                <p className="num mt-2 text-2xl text-ink">{formatPrice(tier.price)}</p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {tier.price === 0 ? "no card needed" : "per month"}
                </p>

                <ul className="mt-3 space-y-1.5">
                  {INCLUDES[key].map((line) => (
                    <li key={line} className="flex gap-2 text-xs text-ink-muted">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink-subtle" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-4">
                  {isCurrent ? (
                    <Button variant="ghost" size="sm" disabled className="w-full">
                      On this plan
                    </Button>
                  ) : isDowngrade ? (
                    <Button variant="ghost" size="sm" className="w-full" onClick={onOpenPortal}>
                      Change in portal
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      size="sm"
                      className="w-full"
                      disabled={!!working}
                      onClick={() => choose(key)}
                    >
                      {working === key ? "Opening…" : `Upgrade to ${tier.name}`}
                    </Button>
                  )}
                </div>
              </motion.li>
            )
          })}
        </motion.ul>
      </Section>

      {plan !== "free" && (
        <Section title="Invoices and payment method" className="mt-8">
          <p className="text-sm text-ink-muted">
            Card details, invoices and receipts are held by Stripe.
          </p>
          <div className="mt-3">
            <Button variant="secondary" size="sm" onClick={onOpenPortal}>
              Open billing portal
            </Button>
          </div>
        </Section>
      )}
    </PageTransition>
  )
}
