'use client'

import { useEffect, useState } from 'react'

type Status = {
  company: {
    id: string
    name: string
    dpa_accepted_at?: string | null
    dpa_accepted_by_name?: string | null
    dpa_version?: string | null
  }
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
      {/* // account-compliance-section-2026-05-20 */}
      {/* Account & Compliance - GDPR docs, DPA acceptance, sub-processors */}
      <section className="bg-white border rounded-lg p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">Account & compliance</h2>
            <p className="text-sm text-gray-600 mt-1">Legal documents, GDPR pack, and your Data Processing Agreement.</p>
          </div>
        </div>

        {status.company?.dpa_accepted_at ? (
          <div className="flex items-start gap-3 p-3 mb-4 bg-green-50 border border-green-200 rounded">
            <div className="text-green-700 text-lg leading-none mt-0.5">✓</div>
            <div className="flex-1">
              <p className="text-sm font-medium text-green-900">
                Data Processing Agreement accepted on {new Date(status.company.dpa_accepted_at).toLocaleDateString('en-GB')}
                {status.company.dpa_accepted_by_name ? ' by ' + status.company.dpa_accepted_by_name : ''}
              </p>
              <p className="text-xs text-green-700 mt-0.5">
                Version {status.company.dpa_version || '1.0'}. This record is your evidence of compliance.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3 p-3 mb-4 bg-orange-50 border border-orange-200 rounded">
            <div className="text-orange-700 text-lg leading-none mt-0.5">!</div>
            <div className="flex-1">
              <p className="text-sm font-medium text-orange-900">DPA not yet accepted</p>
              <p className="text-xs text-orange-700 mt-0.5 mb-2">
                Please download and review the DPA below, then click accept on behalf of {status.company.name}.
              </p>
              <button
                onClick={async () => {
                  if (!confirm('Confirm: by clicking accept you are accepting the Vantro Data Processing Agreement on behalf of ' + status.company.name + '. This will be logged with your name and the date. Continue?')) return
                  setBusy('dpa-accept')
                  setError(null)
                  try {
                    const res = await fetch('/api/account/accept-dpa', { method: 'POST' })
                    const data = await res.json()
                    if (!res.ok) throw new Error(data.error || 'Failed')
                    await load()
                  } catch (e: any) {
                    setError(e.message)
                  } finally {
                    setBusy(null)
                  }
                }}
                disabled={busy === 'dpa-accept'}
                className="px-3 py-1.5 bg-purple-600 text-white text-sm font-medium rounded hover:bg-purple-700 disabled:opacity-50"
              >
                {busy === 'dpa-accept' ? 'Saving…' : 'I accept the DPA'}
              </button>
            </div>
          </div>
        )}

        <h3 className="text-sm font-semibold text-gray-900 mb-3">Documents</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
          {[
            { file: 'Vantro_Privacy_Policy.docx', title: 'Privacy Policy', desc: 'Our full privacy policy under UK GDPR.' },
            { file: 'Vantro_Data_Processing_Agreement.docx', title: 'Data Processing Agreement', desc: 'DPA naming you as Controller and Vantro as Processor.' },
            { file: 'Vantro_GPS_Tracking_Explainer.docx', title: 'GPS Tracking Explainer', desc: 'For installers. Plain English on how tracking works.' },
            { file: 'Vantro_Installer_HowTo_Guide.docx', title: 'Installer How-To Guide', desc: 'One-page practical walkthrough.' },
            { file: 'Vantro_GDPR_QuickRef_for_Andy.docx', title: 'GDPR Quick-Reference', desc: 'Talking points for managers briefing the team.' },
          ].map((doc) => (
            <a
              key={doc.file}
              href={'/legal/' + doc.file}
              download
              className="flex items-start gap-3 p-3 border border-gray-200 rounded hover:border-purple-300 hover:bg-purple-50 transition-colors"
            >
              <div className="text-purple-600 text-base mt-0.5">⤓</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">{doc.title}</p>
                <p className="text-xs text-gray-600 mt-0.5">{doc.desc}</p>
              </div>
            </a>
          ))}
        </div>

        <div className="p-3 mb-6 bg-blue-50 border border-blue-200 rounded">
          <p className="text-xs text-blue-900">
            <span className="font-semibold">Rollout tip:</span> Send the GPS Tracking Explainer and the Installer How-To Guide to every installer before they start using Vantro. The Andy Quick-Ref is the script for the office manager doing the briefing.
          </p>
        </div>

        <h3 className="text-sm font-semibold text-gray-900 mb-3">Sub-processors</h3>
        <p className="text-xs text-gray-600 mb-3">Third-party services Vantro uses to deliver the platform. Documented in the DPA.</p>
        <div className="border border-gray-200 rounded overflow-hidden mb-6">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-700 text-xs uppercase tracking-wider">Sub-processor</th>
                <th className="px-3 py-2 text-left font-medium text-gray-700 text-xs uppercase tracking-wider">Purpose</th>
                <th className="px-3 py-2 text-left font-medium text-gray-700 text-xs uppercase tracking-wider">Region</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {[
                ['Supabase', 'Database, auth, storage', 'EU (Frankfurt)'],
                ['Cloudflare R2', 'Photo, receipt, video storage', 'EU'],
                ['Cloudflare Stream', 'Walk & Talk video delivery', 'EU'],
                ['Resend', 'Transactional email', 'EU'],
                ['Google Cloud (Gemini)', 'AI summaries, OCR, diary analysis', 'Multi-region'],
                ['Vercel', 'Web hosting', 'Multi-region'],
                ['Sentry', 'Error monitoring', 'EU'],
                ['Stripe', 'Payments (PCI-DSS L1)', 'Multi-region'],
                ['Google Maps', 'Address geocoding', 'Multi-region'],
                ['Apple Push Notification Service', 'iOS push notifications', 'US'],
                ['Firebase Cloud Messaging', 'Android push notifications', 'US'],
              ].map(([name, purpose, region]) => (
                <tr key={name}>
                  <td className="px-3 py-2 font-medium text-gray-900">{name}</td>
                  <td className="px-3 py-2 text-gray-700">{purpose}</td>
                  <td className="px-3 py-2 text-gray-500 text-xs">{region}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 className="text-sm font-semibold text-gray-900 mb-3">Security at a glance</h3>
        <ul className="text-sm text-gray-700 space-y-1.5 mb-6 list-disc list-inside">
          <li>All data encrypted in transit (TLS 1.2+) and at rest (AES-256)</li>
          <li>Row-level tenant isolation between every customer&apos;s data</li>
          <li>Daily automated backups with 30-day retention</li>
          <li>Audit logging of admin actions</li>
          <li>Rate limiting on authentication and AI endpoints</li>
          <li>72-hour breach notification commitment</li>
          <li>EU-region primary infrastructure</li>
        </ul>

        <div className="pt-4 border-t text-xs text-gray-500 space-y-0.5">
          <p>Current document version: <span className="font-medium text-gray-700">1.0</span></p>
          <p>Effective from: <span className="font-medium text-gray-700">20 May 2026</span></p>
          <p>Questions: <a href="mailto:aileen@applyscale8.com" className="text-purple-600 hover:underline">aileen@applyscale8.com</a></p>
        </div>
      </section>

    </div>
  )
}
