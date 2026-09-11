'use client'

/**
 * Free signup. Two fields.
 *
 * It used to ask for five: company, your name, email, password, headcount.
 * Every one of those is a chance to leave, and four of them we either do not
 * need or can work out later -- the name comes off the email until they change
 * it, the headcount does not pick a price any more, and there is no password
 * because there is no password: signing in is a magic link.
 *
 * What is left is the only two facts we cannot invent: which company, and
 * where to send the link.
 */

import { useState } from 'react'
import Link from 'next/link'
import { PLANS, SIGNUP_PLAN } from '@/lib/billing'

export default function SignupPage() {
  const [companyName, setCompanyName] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)

  const tier = PLANS[SIGNUP_PLAN]

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/signup/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          companyName: companyName.trim(),
          plan: SIGNUP_PLAN,
        }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.detail ? `${data.error}: ${data.detail}` : data.error)
        setLoading(false)
        return
      }

      // Free signup has no card step and no password, so there is nowhere to
      // send them except their inbox. A paid path would return a checkoutUrl.
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl
        return
      }
      setSentTo(email.trim())
    } catch (err: any) {
      setError(err?.message || 'Network error. Please try again.')
    } finally {
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
          <p className="text-[#4d6478] text-sm mt-2">Free. No card. No contract.</p>
        </div>

        {sentTo ? (
          <div className="bg-[#1a2635] border border-white/5 rounded-2xl p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-[#00d4a0]/10 flex items-center justify-center mx-auto mb-4">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00d4a0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/>
              </svg>
            </div>
            <h1 className="text-lg font-semibold text-white mb-2">Check your email</h1>
            <p className="text-sm text-[#8fa3b8] leading-relaxed">
              We have sent a sign-in link to <span className="text-white">{sentTo}</span>.
              Tap it and you are in — there is no password to set.
            </p>
            <p className="text-xs text-[#4d6478] mt-4">
              Nothing after a minute or two? Check your spam folder, or{' '}
              <button
                onClick={() => { setSentTo(null); setError('') }}
                className="text-[#00d4a0] hover:text-[#00a87e] underline"
              >
                try a different address
              </button>.
            </p>
          </div>
        ) : (
          <div className="bg-[#1a2635] border border-white/5 rounded-2xl p-8">
            <h1 className="text-xl font-semibold text-white mb-6">Create your account</h1>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#8fa3b8] mb-2">Company name</label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="e.g. Smith Glazing Ltd"
                  required
                  disabled={loading}
                  data-testid="signup-company"
                  className="w-full bg-[#243040] border border-white/5 rounded-xl px-4 py-3 text-white placeholder-[#4d6478] focus:outline-none focus:border-[#00d4a0]/40 text-sm disabled:opacity-60"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#8fa3b8] mb-2">Work email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="john@smithglazing.com"
                  required
                  disabled={loading}
                  data-testid="signup-email"
                  className="w-full bg-[#243040] border border-white/5 rounded-xl px-4 py-3 text-white placeholder-[#4d6478] focus:outline-none focus:border-[#00d4a0]/40 text-sm disabled:opacity-60"
                />
              </div>

              <div className="bg-[#243040]/50 border border-[#00d4a0]/20 rounded-xl p-4">
                <p className="text-xs text-[#4d6478] uppercase tracking-wide mb-1">Your plan</p>
                <div className="flex items-baseline justify-between">
                  <span className="text-white font-semibold">{tier.name}</span>
                  <span className="text-2xl font-bold text-white">£0</span>
                </div>
                <p className="text-xs text-[#8fa3b8] mt-1">
                  {tier.blurb} No card needed. Shifts are kept for 5 days on Free.
                  Upgrade from the Billing tab when you want payroll export, QR codes or
                  compliance packs. Cancel any time. No contract. No notice period.
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
                data-testid="signup-submit"
                className="w-full bg-[#00d4a0] hover:bg-[#00a87e] disabled:opacity-50 text-[#0f1923] font-semibold rounded-xl py-3 text-sm transition-colors"
              >
                {loading ? 'Setting up…' : 'Create account'}
              </button>

              <p className="text-xs text-[#4d6478] text-center leading-relaxed">
                No password to invent. We email you a link that signs you in.
              </p>
            </form>
          </div>
        )}

        <p className="text-center text-sm text-[#4d6478] mt-6">
          Already have an account? <Link href="/login" className="text-[#00d4a0] hover:text-[#00a87e]">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
