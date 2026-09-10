"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { TIERS, AI_AUDIT_PACK, type TierKey } from "@/lib/billing"
import { isFieldRole } from "@/lib/roles"
import { PageTransition, PageHeader, Section, Stat } from "@/components/ui/Page"
import { Button } from "@/components/ui/Button"
import { listVariants, itemVariants } from "@/components/ui/motion"
import UpgradeAIAuditPack from "@/components/admin/UpgradeAIAuditPack"

// Billing had no home. The pieces existed and were not reachable: the Stripe
// portal handler had no call site, and BillingComponents.tsx was imported
// nowhere at all. The only live surface was the trial-expiry PaywallOverlay,
// which appears when it is already too late to act.
//
// PaywallOverlay is deliberately NOT opened from here. It takes no onClose, so
// a button that showed it would leave an admin with no way back out. It stays
// what it is - the automatic gate the dashboard raises on expiry - and this tab
// offers the same tiers through the same /api/billing/upgrade route.

type Props = {
  company: any
  teamMembers: any[]
  onOpenPortal: () => void
}

const TIER_KEYS: TierKey[] = ["starter", "growth", "scale"]

function trialDaysLeft(endsAt?: string | null): number | null {
  if (!endsAt) return null
  const ms = new Date(endsAt).getTime() - Date.now()
  if (!Number.isFinite(ms) || ms <= 0) return null
  return Math.max(1, Math.ceil(ms / 86_400_000))
}

export default function BillingTab({ company, teamMembers, onOpenPortal }: Props) {
  const [upgrading, setUpgrading] = React.useState<TierKey | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const currentPlan: TierKey | undefined = company?.current_plan
  const limit: number | null = company?.installer_limit ?? null

  // Counted the same way the limit is enforced on add, so the figure here and
  // the refusal there cannot disagree.
  const activeInstallers = (teamMembers || []).filter(
    (m: any) => (isFieldRole(m.role) || m.role === "foreman") && m.is_active !== false
  ).length

  const aiAuditPaid = !!company?.stripe_ai_audit_subscription_item_id
  const aiAuditTrial = trialDaysLeft(company?.ai_audit_trial_ends_at)
  const aiAuditOn = !!company?.ai_audit_enabled

  async function subscribe(tier: TierKey) {
    setUpgrading(tier)
    setError(null)
    try {
      const res = await fetch("/api/billing/upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPlan: tier }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error || "Could not change plan. Try again or use the billing portal.")
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
      setUpgrading(null)
    }
  }

  const overLimit = limit != null && activeInstallers > limit

  return (
    <PageTransition>
      <PageHeader
        title="Billing"
        description="Your plan, what it covers, and where the invoices live."
        actions={
          <Button variant="secondary" size="sm" onClick={onOpenPortal}>
            Manage billing
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-6 border-t border-line pt-6 md:grid-cols-3">
        <Stat
          label="Plan"
          value={currentPlan ? TIERS[currentPlan]?.name ?? currentPlan : "None"}
          hint={currentPlan ? `£${TIERS[currentPlan]?.price}/month` : "No active subscription"}
        />
        <Stat
          label="Installers"
          value={limit != null ? `${activeInstallers}/${limit}` : String(activeInstallers)}
          hint={overLimit ? `${activeInstallers - limit!} over your limit` : limit != null ? "Within your limit" : "No limit set"}
        />
        <Stat
          label="AI Audit Pack"
          value={aiAuditPaid ? "Active" : aiAuditTrial ? `${aiAuditTrial}d trial` : aiAuditOn ? "Active" : "Off"}
          hint={aiAuditPaid || aiAuditOn ? `£${AI_AUDIT_PACK.price}/month` : AI_AUDIT_PACK.description}
        />
      </div>

      {overLimit && (
        <div className="mt-6 rounded-md border border-warn/30 bg-warn-wash p-4">
          <p className="text-sm text-ink">
            You are {activeInstallers - limit!} over your plan limit of {limit} installers.
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            Everyone keeps working. To add more, move up a plan below or remove a user.
          </p>
        </div>
      )}

      <Section title="Plans" className="mt-8">
        {error && <p className="mb-3 text-sm text-danger">{error}</p>}
        <motion.ul initial="hidden" animate="visible" variants={listVariants} className="grid gap-4 md:grid-cols-3">
          {TIER_KEYS.map((key) => {
            const tier = TIERS[key]
            const isCurrent = currentPlan === key
            const tooSmall = tier.installerLimit < activeInstallers
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
                  {isCurrent && <span className="text-[11px] font-medium text-accent-ink">Current</span>}
                </div>
                <p className="num mt-2 text-2xl text-ink">£{tier.price}</p>
                <p className="mt-0.5 text-xs text-ink-muted">per month</p>
                <p className="mt-3 text-xs text-ink-muted">Up to {tier.installerLimit} installers</p>
                <div className="mt-4">
                  {isCurrent ? (
                    <Button variant="ghost" size="sm" disabled className="w-full">On this plan</Button>
                  ) : (
                    <Button
                      variant={tooSmall ? "ghost" : "primary"}
                      size="sm"
                      className="w-full"
                      disabled={!!upgrading || tooSmall}
                      title={tooSmall ? `You have ${activeInstallers} installers, more than this plan allows` : undefined}
                      onClick={() => subscribe(key)}
                    >
                      {upgrading === key ? "Opening…" : tooSmall ? "Too small" : currentPlan ? "Switch" : "Choose"}
                    </Button>
                  )}
                </div>
              </motion.li>
            )
          })}
        </motion.ul>
      </Section>

      <Section title="AI Audit Pack" className="mt-8">
        {aiAuditPaid ? (
          <p className="text-sm text-ink-muted">
            Active at £{AI_AUDIT_PACK.price}/month. Cancel or change it in the billing portal.
          </p>
        ) : aiAuditTrial ? (
          <p className="text-sm text-ink-muted">
            {aiAuditTrial} {aiAuditTrial === 1 ? "day" : "days"} left in your trial. It becomes
            £{AI_AUDIT_PACK.price}/month after that unless you cancel.
          </p>
        ) : (
          <UpgradeAIAuditPack />
        )}
      </Section>

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
    </PageTransition>
  )
}
