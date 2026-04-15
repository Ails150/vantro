// ============================================================
// hooks/useBillingGate.ts
// Client-side billing state — use in admin dashboard
// ============================================================

'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatTrialDaysRemaining, type TierKey, TIERS, getNextTier } from '@/lib/billing'

export type BillingState = {
  loading: boolean
  plan: TierKey | null
  subscriptionStatus: string | null
  installerLimit: number
  activeInstallers: number
  trialDaysRemaining: number
  isTrialExpired: boolean
  isBlocked: boolean
  blockReason: string | null
  isAtInstallerLimit: boolean
  isNearInstallerLimit: boolean // within 5 of limit
  nextTier: TierKey | null
  cardCollected: boolean
  shouldShowCardPrompt: boolean // day 25-30 during trial
}

export function useBillingGate(companyId: string | null): BillingState {
  const [state, setState] = useState<BillingState>({
    loading: true,
    plan: null,
    subscriptionStatus: null,
    installerLimit: 40,
    activeInstallers: 0,
    trialDaysRemaining: 30,
    isTrialExpired: false,
    isBlocked: false,
    blockReason: null,
    isAtInstallerLimit: false,
    isNearInstallerLimit: false,
    nextTier: null,
    cardCollected: false,
    shouldShowCardPrompt: false,
  })

  useEffect(() => {
    if (!companyId) return
    const supabase = createClient()

    async function fetchBilling() {
      const { data: company } = await supabase
        .from('companies')
        .select(`
          plan,
          subscription_status,
          installer_limit,
          trial_ends_at,
          card_collected_at
        `)
        .eq('id', companyId!)
        .single()

      if (!company) {
        setState(s => ({ ...s, loading: false }))
        return
      }

      // Count active installers
      const { count: installerCount } = await supabase
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId!)
        .eq('role', 'installer')
        .neq('status', 'removed')

      const activeInstallers = installerCount || 0
      const installerLimit = company.installer_limit || 40
      const trialDaysRemaining = formatTrialDaysRemaining(company.trial_ends_at)
      const isTrialExpired = trialDaysRemaining === 0 && company.subscription_status === 'trial'
      const isBlocked = isTrialExpired || ['cancelled', 'blocked'].includes(company.subscription_status)
      const plan = company.plan as TierKey
      const nextTier = plan ? getNextTier(plan) : null
      const cardCollected = !!company.card_collected_at
      const shouldShowCardPrompt = 
        company.subscription_status === 'trial' && 
        trialDaysRemaining <= 5 && 
        !cardCollected

      setState({
        loading: false,
        plan,
        subscriptionStatus: company.subscription_status,
        installerLimit,
        activeInstallers,
        trialDaysRemaining,
        isTrialExpired,
        isBlocked,
        blockReason: isTrialExpired ? 'trial_expired' : 
                     company.subscription_status === 'cancelled' ? 'subscription_cancelled' : null,
        isAtInstallerLimit: activeInstallers >= installerLimit,
        isNearInstallerLimit: activeInstallers >= installerLimit - 5,
        nextTier,
        cardCollected,
        shouldShowCardPrompt,
      })
    }

    fetchBilling()
  }, [companyId])

  return state
}


// ============================================================
// hooks/useCanAddInstaller.ts
// Call before adding any installer — returns blocked state
// ============================================================

export function useCanAddInstaller(billing: BillingState): {
  canAdd: boolean
  reason: string | null
  upgradeRequired: TierKey | null
} {
  if (billing.loading) return { canAdd: false, reason: null, upgradeRequired: null }
  if (billing.isAtInstallerLimit) {
    return {
      canAdd: false,
      reason: `You've reached your ${billing.installerLimit}-installer limit on the ${billing.plan} plan.`,
      upgradeRequired: billing.nextTier,
    }
  }
  return { canAdd: true, reason: null, upgradeRequired: null }
}