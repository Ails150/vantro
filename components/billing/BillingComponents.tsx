'use client'
// components/billing/BillingBanner.tsx
// Shows trial countdown, card prompt, payment failed warning

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { BillingState } from '@/hooks/useBillingGate'

type Props = {
  billing: BillingState
}

export function BillingBanner({ billing }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  if (billing.loading) return null

  async function handleAddCard() {
    setLoading(true)
    const res = await fetch('/api/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'setup' })
    })
    const { url } = await res.json()
    if (url) window.location.href = url
    setLoading(false)
  }

  async function handleSubscribe() {
    setLoading(true)
    const res = await fetch('/api/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'subscribe' })
    })
    const { url } = await res.json()
    if (url) window.location.href = url
    setLoading(false)
  }

  // Trial expiry warning (days 25-30) — card not yet collected
  if (billing.shouldShowCardPrompt) {
    const urgent = billing.trialDaysRemaining <= 2
    return (
      <div className={`w-full px-4 py-3 flex items-center justify-between gap-4 text-sm ${urgent ? 'bg-red-50 border-b border-red-200' : 'bg-amber-50 border-b border-amber-200'}`}>
        <div className="flex items-center gap-2">
          <span>{urgent ? '🚨' : '⏰'}</span>
          <span className={urgent ? 'text-red-800 font-medium' : 'text-amber-800'}>
            {billing.trialDaysRemaining === 0
              ? 'Your trial ends today. Add a card to keep access.'
              : `Your trial ends in ${billing.trialDaysRemaining} day${billing.trialDaysRemaining === 1 ? '' : 's'}. Add a card to continue uninterrupted.`}
          </span>
        </div>
        <button
          onClick={handleAddCard}
          disabled={loading}
          className="flex-shrink-0 bg-teal-600 text-white text-xs font-semibold px-4 py-2 rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Add card →'}
        </button>
      </div>
    )
  }

  // Trial active — days 1-24
  if (billing.subscriptionStatus === 'trial' && billing.trialDaysRemaining > 5) {
    return (
      <div className="w-full px-4 py-2.5 flex items-center gap-2 text-sm bg-teal-50 border-b border-teal-100">
        <span>🎉</span>
        <span className="text-teal-800">
          Free trial — <strong>{billing.trialDaysRemaining} days</strong> remaining. No card needed yet.
        </span>
      </div>
    )
  }

  // Payment failed
  if (billing.subscriptionStatus === 'past_due') {
    return (
      <div className="w-full px-4 py-3 flex items-center justify-between gap-4 text-sm bg-red-50 border-b border-red-200">
        <div className="flex items-center gap-2">
          <span>❌</span>
          <span className="text-red-800 font-medium">Payment failed. Please update your payment method to maintain access.</span>
        </div>
        <button
          onClick={handleSubscribe}
          disabled={loading}
          className="flex-shrink-0 bg-red-600 text-white text-xs font-semibold px-4 py-2 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Fix payment →'}
        </button>
      </div>
    )
  }

  // Near installer limit
  if (billing.isNearInstallerLimit && !billing.isAtInstallerLimit) {
    return (
      <div className="w-full px-4 py-2.5 flex items-center justify-between gap-4 text-sm bg-amber-50 border-b border-amber-200">
        <div className="flex items-center gap-2">
          <span>⚠️</span>
          <span className="text-amber-800">
            You have {billing.installerLimit - billing.activeInstallers} installer slot{billing.installerLimit - billing.activeInstallers === 1 ? '' : 's'} remaining on your {billing.plan} plan.
          </span>
        </div>
        {billing.nextTier && (
          <button
            onClick={() => router.push('/admin?tab=billing')}
            className="flex-shrink-0 text-teal-600 text-xs font-semibold underline"
          >
            Upgrade →
          </button>
        )}
      </div>
    )
  }

  return null
}


// ============================================================
// components/billing/InstallerLimitModal.tsx
// Shown when admin tries to add an installer but is at limit
// ============================================================

import { TIERS, type TierKey } from '@/lib/billing'

type ModalProps = {
  isOpen: boolean
  onClose: () => void
  currentPlan: TierKey
  currentLimit: number
  nextTier: TierKey | null
  onUpgrade: (tier: TierKey) => void
  upgradeLoading?: boolean
}

export function InstallerLimitModal({
  isOpen,
  onClose,
  currentPlan,
  currentLimit,
  nextTier,
  onUpgrade,
  upgradeLoading = false,
}: ModalProps) {
  if (!isOpen) return null

  const nextTierDetails = nextTier ? TIERS[nextTier] : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">👥</span>
          </div>
          <h2 className="text-xl font-bold text-gray-900">Installer limit reached</h2>
          <p className="text-gray-500 text-sm mt-2">
            Your <strong>{TIERS[currentPlan].name}</strong> plan supports up to{' '}
            <strong>{currentLimit} installers</strong>.
            Upgrade to add more.
          </p>
        </div>

        {nextTierDetails ? (
          <div className="border-2 border-teal-600 rounded-xl p-5 bg-teal-50 mb-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-bold text-gray-900">{nextTierDetails.name}</p>
                <p className="text-sm text-gray-600 mt-0.5">Up to {nextTierDetails.installerLimit} installers</p>
                <p className="text-xs text-teal-700 mt-1">
                  +£{nextTierDetails.price - TIERS[currentPlan].price}/mo — difference charged immediately
                </p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-gray-900">£{nextTierDetails.price}</p>
                <p className="text-xs text-gray-400">/month</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-4 bg-gray-50 rounded-xl mb-6 text-center">
            <p className="text-sm text-gray-600">
              You&apos;re on our largest plan. For teams over 100 installers, contact us for enterprise pricing.
            </p>
            <a href="mailto:hello@getvantro.com" className="text-teal-600 font-semibold text-sm mt-2 block">
              hello@getvantro.com
            </a>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {nextTier && (
            <button
              onClick={() => onUpgrade(nextTier)}
              disabled={upgradeLoading}
              className="w-full bg-teal-600 text-white py-3 rounded-lg font-semibold hover:bg-teal-700 transition-colors disabled:opacity-50"
            >
              {upgradeLoading ? 'Processing…' : `Upgrade to ${nextTierDetails?.name} →`}
            </button>
          )}
          <button
            onClick={onClose}
            className="w-full text-sm text-gray-500 hover:text-gray-700 py-2"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  )
}


// ============================================================
// components/billing/TrialExpiredGate.tsx
// Full-screen block shown when trial has expired
// ============================================================

type GateProps = {
  plan: TierKey
  onSubscribe: () => void
  loading?: boolean
}

export function TrialExpiredGate({ plan, onSubscribe, loading = false }: GateProps) {
  const tier = TIERS[plan]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 text-center">
        <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <span className="text-4xl">⏱️</span>
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-3">Your free trial has ended</h2>
        <p className="text-gray-500 mb-8">
          Subscribe to continue using Vantro. Your data is safe — nothing has been deleted.
        </p>

        <div className="border border-gray-200 rounded-xl p-5 mb-6 text-left">
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-gray-900">{tier.name} plan</span>
            <span className="text-xl font-bold text-gray-900">£{tier.price}<span className="text-sm font-normal text-gray-400">/mo</span></span>
          </div>
          <p className="text-sm text-gray-500">Up to {tier.installerLimit} installers — all features included</p>
        </div>

        <button
          onClick={onSubscribe}
          disabled={loading}
          className="w-full bg-teal-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-teal-700 transition-colors disabled:opacity-50 mb-4"
        >
          {loading ? 'Loading…' : `Subscribe — £${tier.price}/mo →`}
        </button>

        <p className="text-xs text-gray-400">
          Cancel any time. Questions?{' '}
          <a href="mailto:hello@getvantro.com" className="underline">hello@getvantro.com</a>
        </p>
      </div>
    </div>
  )
}