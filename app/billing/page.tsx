'use client'
import { useState } from 'react'

export default function BillingPage() {
  const [loading, setLoading] = useState(false)

  async function subscribe() {
    setLoading(true)
    const res = await fetch('/api/billing/checkout', { method: 'POST' })
    const data = await res.json()
    if (data.url) window.location.href = data.url
    else setLoading(false)
  }

  return (
    <div className="min-h-screen bg-[#0f1923] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#00d4a0] flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none"><rect x="2" y="2" width="7" height="7" rx="1.5" fill="#0f1923"/><rect x="11" y="2" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.7"/><rect x="2" y="11" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.7"/><rect x="11" y="11" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.4"/></svg>
            </div>
            <span className="text-white text-xl font-semibold">Van<span className="text-[#00d4a0]">tro</span></span>
          </div>
        </div>
        <div className="bg-[#1a2635] border border-white/5 rounded-2xl p-8 text-center">
          <h1 className="text-white text-2xl font-semibold mb-2">Your trial has ended</h1>
          <p className="text-[#4d6478] mb-8">Subscribe to keep your team connected and your jobs running.</p>
          <div className="bg-[#243040] rounded-xl p-6 mb-8 text-left">
            <div className="text-[#00d4a0] text-3xl font-bold mb-1">£199<span className="text-base font-normal text-[#4d6478]">/month</span></div>
            <div className="text-[#4d6478] text-sm mb-4">Unlimited installers. No per-seat fees.</div>
            <div className="space-y-2 text-sm text-white">
              {['GPS sign-in enforcement','Site diary with AI alerts','QA checklists and approvals','Defect logging','Push notifications','Payroll-ready reports'].map(f => (
                <div key={f} className="flex items-center gap-2">
                  <span className="text-[#00d4a0]">✓</span>{f}
                </div>
              ))}
            </div>
          </div>
          <button onClick={subscribe} disabled={loading} className="w-full bg-[#00d4a0] hover:bg-[#00a87e] disabled:opacity-40 text-[#0f1923] font-semibold rounded-xl py-3 text-sm transition-colors">
            {loading ? 'Redirecting to checkout...' : 'Subscribe now — £199/month'}
          </button>
          <p className="text-[#4d6478] text-xs mt-4">Cancel anytime. No contracts.</p>
        </div>
      </div>
    </div>
  )
}
