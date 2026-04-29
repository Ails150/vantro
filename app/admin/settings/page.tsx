'use client'

import { useEffect, useState } from 'react'

type Status = {
  company: { id: string; name: string }
  plan: { key: string; name: string; price: number; installerLimit: number }
  usage: { installers: number }
  subscription: {
    status: string
    trialDaysRemaining: number | null
    stripe: {
      status: string
      current_period_end: number
      cancel_at_period_end: boolean
      cancel_at: number | null
    } | null
  }
  role: string
  tiers: Array<{ key: string; name: string; price: number; installerLimit: number }>
}

export default function SettingsPage() {
  const [status, setStatus] = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/billing/status')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load')
      setStatus(data)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const switchPlan = async (newPlan: string) => {
    setBusy(`switch-${newPlan}`)
    setError(null)
    try {
      const res = await fetch('/api/billing/upgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPlan }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || data.detail || 'Failed')
      if (data.url) {
        window.location.href = data.url
      } else {
        await load()
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  const openPortal = async () => {
    setBusy('portal')
    setError(null)
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || data.error || 'Failed')
      window.location.href = data.url
    } catch (e: any) {
      setError(e.message)
      setBusy(null)
    }
  }

  const cancelSub = async (action: 'cancel' | 'undo') => {
    setBusy(action)
    setError(null)
    try {
      const res = await fetch('/api/billing/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || data.error || 'Failed')
      setConfirmCancel(false)
      await load()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  if (loading) return <div className="p-8">Loading…</div>
  if (!status) return <div className="p-8 text-red-600">{error || 'No data'}</div>

  const fmtDate = (ts: number) => new Date(ts * 1000).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric'
  })

  const overLimit = status.usage.installers > status.plan.installerLimit
  const isCancelling = status.subscription.stripe?.cancel_at_period_end

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <h1 className="text-2xl font-bold">Settings</h1>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 p-4 rounded">
          {error}
        </div>
      )}

      {/* Current plan */}
      <section className="bg-white border rounded-lg p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">Current plan</h2>
            <p className="text-3xl font-bold mt-2">{status.plan.name}</p>
            <p className="text-gray-600">£{status.plan.price}/month</p>
          </div>
          <div className="text-right">
            <span className={`px-3 py-1 rounded-full text-xs font-medium ${
              status.subscription.status === 'active' ? 'bg-green-100 text-green-800' :
              status.subscription.status === 'trial' ? 'bg-blue-100 text-blue-800' :
              status.subscription.status === 'past_due' ? 'bg-orange-100 text-orange-800' :
              'bg-gray-100 text-gray-800'
            }`}>
              {status.subscription.status === 'trial' && status.subscription.trialDaysRemaining !== null
                ? `Trial — ${status.subscription.trialDaysRemaining} days left`
                : status.subscription.status}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 pt-4 border-t">
          <div>
            <p className="text-xs text-gray-500 uppercase">Installers</p>
            <p className={`text-xl font-semibold ${overLimit ? 'text-red-600' : ''}`}>
              {status.usage.installers} / {status.plan.installerLimit}
            </p>
          </div>
          {status.subscription.stripe?.current_period_end && (
            <div>
              <p className="text-xs text-gray-500 uppercase">
                {isCancelling ? 'Access ends' : 'Next renewal'}
              </p>
              <p className="text-xl font-semibold">
                {fmtDate(status.subscription.stripe.current_period_end)}
              </p>
            </div>
          )}
        </div>

        {isCancelling && (
          <div className="mt-4 p-3 bg-orange-50 border border-orange-200 rounded text-sm">
            <p className="text-orange-800 mb-2">
              Your subscription will end on {fmtDate(status.subscription.stripe!.current_period_end)}.
            </p>
            <button
              onClick={() => cancelSub('undo')}
              disabled={busy === 'undo'}
              className="text-orange-800 underline font-medium"
            >
              {busy === 'undo' ? 'Reactivating…' : 'Keep my subscription'}
            </button>
          </div>
        )}
      </section>

      {/* Change plan */}
      <section className="bg-white border rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-4">Change plan</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {status.tiers.map((tier) => {
            const isCurrent = tier.key === status.plan.key
            const tooSmall = status.usage.installers > tier.installerLimit
            const disabled = isCurrent || tooSmall || busy !== null
            return (
              <div
                key={tier.key}
                className={`border rounded-lg p-4 ${
                  isCurrent ? 'border-purple-500 bg-purple-50' : 'border-gray-200'
                }`}
              >
                <h3 className="font-semibold">{tier.name}</h3>
                <p className="text-2xl font-bold mt-1">£{tier.price}<span className="text-sm font-normal text-gray-500">/mo</span></p>
                <p className="text-sm text-gray-600 mt-1">Up to {tier.installerLimit} installers</p>
                <button
                  onClick={() => switchPlan(tier.key)}
                  disabled={disabled}
                  className={`mt-4 w-full py-2 rounded font-medium text-sm ${
                    isCurrent
                      ? 'bg-gray-100 text-gray-500 cursor-default'
                      : tooSmall
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-purple-600 text-white hover:bg-purple-700'
                  }`}
                >
                  {busy === `switch-${tier.key}` ? 'Loading…' :
                   isCurrent ? 'Current plan' :
                   tooSmall ? `Need ≤${tier.installerLimit} installers` :
                   'Switch to this plan'}
                </button>
              </div>
            )
          })}
        </div>
      </section>

      {/* Billing & invoices */}
      <section className="bg-white border rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-2">Payment & invoices</h2>
        <p className="text-sm text-gray-600 mb-4">
          Update your payment method, view past invoices, or download receipts.
        </p>
        <button
          onClick={openPortal}
          disabled={busy === 'portal'}
          className="px-4 py-2 border border-gray-300 rounded font-medium hover:bg-gray-50 disabled:opacity-50"
        >
          {busy === 'portal' ? 'Opening…' : 'Manage payment & invoices →'}
        </button>
      </section>

      {/* Cancel */}
      {!isCancelling && status.subscription.stripe && (
        <section className="bg-white border border-red-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-red-700 mb-2">Cancel subscription</h2>
          <p className="text-sm text-gray-600 mb-4">
            You'll keep access until the end of your current billing period
            {status.subscription.stripe?.current_period_end &&
              ` (${fmtDate(status.subscription.stripe.current_period_end)})`}.
            No further charges will be made.
          </p>
          {!confirmCancel ? (
            <button
              onClick={() => setConfirmCancel(true)}
              className="px-4 py-2 border border-red-300 text-red-700 rounded font-medium hover:bg-red-50"
            >
              Cancel subscription
            </button>
          ) : (
            <div className="flex gap-3">
              <button
                onClick={() => cancelSub('cancel')}
                disabled={busy === 'cancel'}
                className="px-4 py-2 bg-red-600 text-white rounded font-medium hover:bg-red-700"
              >
                {busy === 'cancel' ? 'Cancelling…' : 'Yes, cancel'}
              </button>
              <button
                onClick={() => setConfirmCancel(false)}
                className="px-4 py-2 border rounded font-medium"
              >
                Keep subscription
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
