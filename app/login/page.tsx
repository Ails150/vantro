'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    setSent(true)
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-[#0f1923] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-[#00d4a0] flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <rect x="2" y="2" width="7" height="7" rx="1.5" fill="#0f1923"/>
                <rect x="11" y="2" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.7"/>
                <rect x="2" y="11" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.7"/>
                <rect x="11" y="11" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.4"/>
              </svg>
            </div>
            <span className="text-2xl font-semibold text-white tracking-tight">
              Van<span className="text-[#00d4a0]">tro</span>
            </span>
          </div>
          <p className="text-sm text-[#4d6478]">See everything. Control everything. Profit.</p>
        </div>
        {!sent ? (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#8fa3b8] mb-2">Work email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                className="w-full bg-[#1a2635] border border-[rgba(255,255,255,0.07)] rounded-xl px-4 py-3 text-white placeholder-[#4d6478] focus:outline-none focus:border-[#00d4a0] transition-colors text-sm"
              />
            </div>
            {error && (
              <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-3">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#00d4a0] hover:bg-[#00a87e] disabled:opacity-50 text-[#0f1923] font-semibold rounded-xl py-3 text-sm transition-colors"
            >
              {loading ? 'Sending...' : 'Send magic link'}
            </button>
            <p className="text-xs text-[#4d6478] text-center">No password needed. We email you a secure sign-in link.</p>
          </form>
        ) : (
          <div className="text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-[#00d4a0]/10 border border-[#00d4a0]/20 flex items-center justify-center mx-auto">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <path d="M20 6L9 17l-5-5" stroke="#00d4a0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div>
              <h2 className="text-white font-semibold text-lg mb-1">Check your email</h2>
              <p className="text-[#4d6478] text-sm">We sent a magic link to <span className="text-[#8fa3b8]">{email}</span></p>
              <p className="text-[#4d6478] text-sm mt-1">Click the link to sign in to your dashboard.</p>
            </div>
            <button onClick={() => { setSent(false); setEmail('') }} className="text-sm text-[#4d6478] hover:text-[#8fa3b8] transition-colors">
              Use a different email
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
