"use client"

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function UpgradeAIAuditPack() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function handleUpgrade() {
    setLoading(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch('/api/billing/ai-audit', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to upgrade')
        return
      }
      setSuccess(data.message || 'AI Audit Pack added successfully')
      // Refresh server data so AuditTab unlocks
      setTimeout(() => router.refresh(), 800)
    } catch (e: any) {
      setError(e?.message || 'Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-8">
      <div className="bg-gradient-to-br from-teal-50 to-white border border-teal-200 rounded-2xl p-8 md:p-12 text-center shadow-sm">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-teal-100 mb-6">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-teal-600">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>

        <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-3">AI Audit Pack</h1>
        <p className="text-lg text-gray-600 mb-2">Compliance reports, video summaries, and exec briefings</p>
        <div className="text-4xl md:text-5xl font-bold text-teal-600 mt-6 mb-2">£79<span className="text-lg text-gray-500 font-medium">/mo</span></div>
        <p className="text-sm text-gray-500 mb-8">Added to your existing Vantro subscription. One invoice, one card.</p>

        <div className="grid md:grid-cols-3 gap-4 mb-8 text-left">
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-teal-600 font-semibold mb-1 text-sm">AI compliance reports</div>
            <div className="text-xs text-gray-600">Auto-generated audit packs covering every job, every installer, every photo.</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-teal-600 font-semibold mb-1 text-sm">Video AI summaries</div>
            <div className="text-xs text-gray-600">Cloudflare Stream videos analysed and summarised in seconds.</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-teal-600 font-semibold mb-1 text-sm">Executive briefings</div>
            <div className="text-xs text-gray-600">One-page weekly summaries for clients, managers, and homeowners.</div>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 mb-4 text-sm">
            {error}
          </div>
        )}
        {success && (
          <div className="bg-teal-50 border border-teal-200 text-teal-700 rounded-xl px-4 py-3 mb-4 text-sm">
            {success}
          </div>
        )}

        <button
          onClick={handleUpgrade}
          disabled={loading || !!success}
          className="bg-teal-500 hover:bg-teal-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-bold rounded-xl px-8 py-4 text-base transition-colors shadow-sm"
        >
          {loading ? 'Adding to your subscription...' : success ? 'Activating...' : 'Add AI Audit Pack — £79/mo'}
        </button>

        <p className="text-xs text-gray-400 mt-4">
          Cancel anytime via Settings &rarr; Manage subscription. No separate card needed.
        </p>
      </div>
    </div>
  )
}