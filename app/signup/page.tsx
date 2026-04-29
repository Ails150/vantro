'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getTierForInstallerCount, TIERS } from '@/lib/billing'

export default function SignupPage() {
  const router = useRouter()
  const [companyName, setCompanyName] = useState('')
  const [yourName, setYourName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [teamSize, setTeamSize] = useState<number>(5)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Live tier preview based on team size
  const suggestedTier = getTierForInstallerCount(teamSize)
  const tier = TIERS[suggestedTier]

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (teamSize < 1 || teamSize > 100) {
      setError('Team size must be between 1 and 100')
      return
    }

    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/signup/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          companyName: companyName.trim(),
          yourName: yourName.trim(),
          teamSize,
          plan: suggestedTier,
        }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.detail ? `${data.error}: ${data.detail}` : data.error)
        setLoading(false)
        return
      }

      // Redirect to Stripe Checkout
      window.location.href = data.checkoutUrl
    } catch (err: any) {
      setError(err?.message || 'Network error. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0f1923] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#00d4a0] flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                <rect x="2" y="2" width="7" height="7" rx="1.5" fill="#0f1923"/>
                <rect x="11" y="2" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.7"/>
                <rect x="2" y="11" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.7"/>
                <rect x="11" y="11" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.4"/>
              </svg>
            </div>
            <span className="text-xl font-semibold text-white">Van<span className="text-[#00d4a0]">tro</span></span>
          </Link>
          <p className="text-[#4d6478] text-sm mt-2">30 days free. Card required. Cancel anytime.</p>
        </div>

        <div className="bg-[#1a2635] border border-white/5 rounded-2xl p-8">
          <h1 className="text-xl font-semibold text-white mb-6">Create your account</h1>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#8fa3b8] mb-2">Company name</label>
              <input
                type="text"
                value={companyName}
                onChange={e => setCompanyName(e.target.value)}
                placeholder="e.g. Smith Glazing Ltd"
                required
                disabled={loading}
                className="w-full bg-[#243040] border border-white/5 rounded-xl px-4 py-3 text-white placeholder-[#4d6478] focus:outline-none focus:border-[#00d4a0]/40 text-sm disabled:opacity-60"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#8fa3b8] mb-2">Your name</label>
              <input
                type="text"
                value={yourName}
                onChange={e => setYourName(e.target.value)}
                placeholder="John Smith"
                required
                disabled={loading}
                className="w-full bg-[#243040] border border-white/5 rounded-xl px-4 py-3 text-white placeholder-[#4d6478] focus:outline-none focus:border-[#00d4a0]/40 text-sm disabled:opacity-60"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#8fa3b8] mb-2">Work email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="john@smithglazing.com"
                required
                disabled={loading}
                className="w-full bg-[#243040] border border-white/5 rounded-xl px-4 py-3 text-white placeholder-[#4d6478] focus:outline-none focus:border-[#00d4a0]/40 text-sm disabled:opacity-60"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#8fa3b8] mb-2">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                required
                disabled={loading}
                className="w-full bg-[#243040] border border-white/5 rounded-xl px-4 py-3 text-white placeholder-[#4d6478] focus:outline-none focus:border-[#00d4a0]/40 text-sm disabled:opacity-60"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#8fa3b8] mb-2">How many installers?</label>
              <input
                type="number"
                min="1"
                max="100"
                value={teamSize}
                onChange={e => setTeamSize(parseInt(e.target.value || '1', 10))}
                required
                disabled={loading}
                className="w-full bg-[#243040] border border-white/5 rounded-xl px-4 py-3 text-white placeholder-[#4d6478] focus:outline-none focus:border-[#00d4a0]/40 text-sm disabled:opacity-60"
              />
            </div>

            {/* Live tier preview */}
            <div className="bg-[#243040]/50 border border-[#00d4a0]/20 rounded-xl p-4">
              <p className="text-xs text-[#4d6478] uppercase tracking-wide mb-1">Your plan</p>
              <div className="flex items-baseline justify-between">
                <span className="text-white font-semibold">{tier.name}</span>
                <span className="text-white">
                  <span className="text-2xl font-bold">£{tier.price}</span>
                  <span className="text-[#8fa3b8] text-sm">/month</span>
                </span>
              </div>
              <p className="text-xs text-[#8fa3b8] mt-1">
                Up to {tier.installerLimit} installers · 30-day free trial · Cancel anytime
              </p>
            </div>

            {error && (
              <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-3">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#00d4a0] hover:bg-[#00a87e] disabled:opacity-50 text-[#0f1923] font-semibold rounded-xl py-3 text-sm transition-colors"
            >
              {loading ? 'Setting up…' : 'Continue to payment →'}
            </button>

            <p className="text-xs text-[#4d6478] text-center leading-relaxed">
              You won't be charged for 30 days. We'll email you 7 days before your trial ends.
              You can cancel anytime in settings.
            </p>
          </form>
        </div>

        <p className="text-center text-sm text-[#4d6478] mt-6">
          Already have an account? <Link href="/login" className="text-[#00d4a0] hover:text-[#00a87e]">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
