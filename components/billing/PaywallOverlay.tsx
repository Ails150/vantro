'use client'
// components/billing/PaywallOverlay.tsx
// Renders blurred dashboard underlay + paywall modal when trial expired and not subscribed.
// Drop-in: render at top of page, returns null if not gating.

import { useState } from 'react'
import { TIERS, type TierKey } from '@/lib/billing'

type Props = {
  show: boolean
  companyName?: string
  currentPlan?: TierKey
}

export default function PaywallOverlay({ show, companyName, currentPlan }: Props) {
  const [loadingTier, setLoadingTier] = useState<string | null>(null)

  if (!show) return null

  async function handleSubscribe(tier: TierKey) {
    setLoadingTier(tier)
    try {
      const res = await fetch('/api/billing/upgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPlan: tier })
      })
      const data = await res.json()
      if (data?.url) {
        window.location.href = data.url
        return
      }
      if (data?.success) {
        window.location.reload()
        return
      }
      alert(data?.error || 'Could not start subscription. Please contact support.')
    } catch (err: any) {
      alert(err?.message || 'Could not start subscription.')
    }
    setLoadingTier(null)
  }

  const tierKeys: TierKey[] = ['starter', 'growth', 'scale']

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-3xl max-w-2xl w-full p-8 shadow-2xl">
        <div className="text-center mb-6">
          <div className="inline-flex w-14 h-14 rounded-full bg-amber-100 items-center justify-center mb-4">
            <span className="text-2xl">⏰</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Your Vantro trial has ended</h1>
          <p className="text-gray-600">
            Subscribe to keep your{companyName ? ` ${companyName}` : ''} account, jobs, team, and history.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          {tierKeys.map((key) => {
            const tier = TIERS[key]
            const isCurrent = currentPlan === key
            return (
              <button
                key={key}
                onClick={() => handleSubscribe(key)}
                disabled={loadingTier !== null}
                className={`text-left p-5 rounded-xl border-2 transition-all ${
                  isCurrent
                    ? 'border-teal-500 bg-teal-50 hover:border-teal-600'
                    : 'border-gray-200 bg-white hover:border-teal-400'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {isCurrent && (
                  <div className="text-xs text-teal-700 font-semibold mb-1">RECOMMENDED</div>
                )}
                <div className="font-semibold text-lg text-gray-900">{tier.name}</div>
                <div className="text-2xl font-bold text-gray-900 mt-1">£{tier.price}<span className="text-sm font-normal text-gray-500">/mo</span></div>
                <div className="text-sm text-gray-500 mt-2">Up to {tier.installerLimit} installers</div>
                <div className="text-xs text-teal-600 font-semibold mt-3">
                  {loadingTier === key ? 'Loading…' : 'Subscribe →'}
                </div>
              </button>
            )
          })}
        </div>

        <div className="text-center text-xs text-gray-400">
          Your data is safe. Subscribe to access it again.
        </div>
      </div>
    </div>
  )
}
