"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { LifeBuoy, Mail, MessageCircle } from "lucide-react"
import { PLANS, PLAN_ORDER, formatPrice } from "@/lib/billing"
import { toPlan, atLeast, historyDays, type Plan } from "@/lib/plan"
import { hasHumanSupport, type SupportContacts } from "@/lib/support"
import { formatIn } from "@/lib/format-time"
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
  /** Read from env on the server. See lib/support.ts. */
  support: SupportContacts
  /** Opens the in-app Support tab, the fallback when no help centre URL is set. */
  onOpenSupportTab: () => void
  onOpenPortal: () => void
}

/** What the Stripe subscription says about an in-flight cancellation. */
type CancelState = {
  cancelAtPeriodEnd: boolean
  /** Unix seconds. The day access actually stops. */
  endsAt: number | null
}

/** What each plan gets, in the customer's words rather than feature flags. */
const INCLUDES: Record<Plan, string[]> = {
  free: [
    "Geofenced sign in, so hours are verified",
    "Today's board",
    "Invite your team",
    "5 days of history",
  ],
  payroll: [
    "Everything in Free",
    "QR site and worker codes",
    "Manual sign in, for when GPS will not fix",
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

export default function BillingTab({
  company,
  teamMembers,
  support,
  onOpenSupportTab,
  onOpenPortal,
}: Props) {
  const [working, setWorking] = React.useState<Plan | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [cancelState, setCancelState] = React.useState<CancelState | null>(null)
  const [confirmingCancel, setConfirmingCancel] = React.useState(false)
  const [cancelBusy, setCancelBusy] = React.useState(false)

  const plan = toPlan(company?.plan)
  const retention = historyDays(plan)

  // Cancellation state lives in Stripe, not in our companies row, so it is read
  // rather than assumed. A failure here leaves cancelState null and the panel
  // simply does not claim anything about a pending cancellation.
  React.useEffect(() => {
    if (plan === "free") return
    let alive = true
    ;(async () => {
      try {
        const res = await fetch("/api/billing/status")
        if (!res.ok) return
        const data = await res.json()
        const stripe = data?.subscription?.stripe
        if (!alive || !stripe) return
        setCancelState({
          cancelAtPeriodEnd: !!stripe.cancel_at_period_end,
          endsAt: stripe.cancel_at ?? stripe.current_period_end ?? null,
        })
      } catch {}
    })()
    return () => { alive = false }
  }, [plan])

  async function setCancellation(action: "cancel" | "undo") {
    setCancelBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/billing/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error || "Could not change your cancellation. Try the billing portal.")
        return
      }
      setCancelState({
        cancelAtPeriodEnd: !!data.cancel_at_period_end,
        endsAt: data.cancel_at ?? cancelState?.endsAt ?? null,
      })
      setConfirmingCancel(false)
    } catch {
      setError("Could not reach billing. Check your connection and try again.")
    } finally {
      setCancelBusy(false)
    }
  }

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
            Sign in is already checked against the site boundary on Free. What a paid plan
            adds is keeping the record: nothing is deleted, and the hours go out as payroll.
          </p>
        </div>
      )}

      <Section title="Plans" className="mt-8">
        {/* Said next to the prices, because this is the objection the prices
            raise. It is also true: cancelling is one button below, it takes
            effect at the end of the period already paid for, and nothing is
            deleted when it does. */}
        <p className="-mt-2 mb-4 text-sm text-ink-muted">
          Cancel any time. No contract. No notice period.
        </p>
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

      <Section title="Support" className="mt-8">
        {hasHumanSupport(plan) ? (
          <div className="space-y-3">
            <p className="text-sm text-ink">
              You are on {PLANS[plan].name}, so you get a person rather than a form.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {support.whatsappUrl ? (
                <a
                  href={support.whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-8 items-center gap-2 rounded-md border border-line-strong bg-canvas px-3 text-[13px] font-medium text-ink transition-colors duration-fast ease-out hover:bg-surface-hover"
                >
                  <MessageCircle size={14} className="text-accent-ink" />
                  Support: WhatsApp {support.whatsappName}
                </a>
              ) : null}
              <a
                href={"mailto:" + support.email}
                className="inline-flex h-8 items-center gap-2 rounded-md border border-line-strong bg-canvas px-3 text-[13px] font-medium text-ink transition-colors duration-fast ease-out hover:bg-surface-hover"
              >
                <Mail size={14} className="text-ink-subtle" />
                {support.email}
              </a>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-ink-muted">
              Free plans use the help centre. Payroll and Suite get WhatsApp and email
              straight to a person.
            </p>
            <div>
              {support.helpUrl ? (
                <a
                  href={support.helpUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-8 items-center gap-2 rounded-md border border-line-strong bg-canvas px-3 text-[13px] font-medium text-ink transition-colors duration-fast ease-out hover:bg-surface-hover"
                >
                  <LifeBuoy size={14} className="text-ink-subtle" />
                  Help centre
                </a>
              ) : (
                <Button variant="secondary" size="sm" onClick={onOpenSupportTab}>
                  Help centre
                </Button>
              )}
            </div>
          </div>
        )}
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

      {/* Cancelling is last, and it is a plain button rather than a buried
          portal link. One confirmation, and it says exactly what happens:
          nothing stops today, nothing is deleted, and it can be undone. */}
      {plan !== "free" && (
        <Section title="Cancel" className="mt-8">
          {cancelState?.cancelAtPeriodEnd ? (
            <div className="space-y-3">
              <p className="text-sm text-ink">
                Cancelled. {PLANS[plan].name} runs until{" "}
                <span className="num">{formatEndDate(cancelState.endsAt)}</span>, then this
                company moves to Free. Your jobs, people and history stay where they are.
              </p>
              <Button
                variant="secondary"
                size="sm"
                disabled={cancelBusy}
                onClick={() => setCancellation("undo")}
              >
                {cancelBusy ? "Working…" : "Keep my plan"}
              </Button>
            </div>
          ) : confirmingCancel ? (
            <div className="rounded-md border border-line-strong bg-surface p-4">
              <p className="text-sm font-medium text-ink">Cancel {PLANS[plan].name}?</p>
              <ul className="mt-2 space-y-1.5">
                {[
                  "You keep " + PLANS[plan].name + " until " + formatEndDate(cancelState?.endsAt) + ", the period you have already paid for.",
                  "There is no notice period and no cancellation fee.",
                  "After that this company moves to Free. Nothing is deleted.",
                  "You can undo this at any point before then.",
                ].map((line) => (
                  <li key={line} className="flex gap-2 text-xs text-ink-muted">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink-subtle" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  tone="danger"
                  size="sm"
                  disabled={cancelBusy}
                  onClick={() => setCancellation("cancel")}
                >
                  {cancelBusy ? "Cancelling…" : "Yes, cancel at period end"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={cancelBusy}
                  onClick={() => setConfirmingCancel(false)}
                >
                  Keep my plan
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-ink-muted">
                Cancel any time. No contract, no notice period. You keep{" "}
                {PLANS[plan].name} until the end of the period you have paid for, then this
                company moves to Free with all of its data intact.
              </p>
              <Button variant="secondary" size="sm" onClick={() => setConfirmingCancel(true)}>
                Cancel plan
              </Button>
            </div>
          )}
        </Section>
      )}
    </PageTransition>
  )
}

/** Stripe gives unix seconds. An unknown date must not print "Invalid Date". */
function formatEndDate(unixSeconds: number | null | undefined): string {
  if (!unixSeconds) return "the end of your billing period"
  return formatIn(unixSeconds * 1000, { day: "numeric", month: "long", year: "numeric" })
}
