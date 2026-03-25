'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function SignupPage() {
  const router = useRouter()
  const [companyName, setCompanyName] = useState('')
  const [yourName, setYourName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    setLoading(true)
    setError('')

    const supabase = createClient()

    // Create auth user
    const { data, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { company_name: companyName, full_name: yourName },
        emailRedirectTo: `${window.location.origin}/auth/callback`
      }
    })

    if (authError) {
      setError(authError.message)
      setLoading(false)
      return
    }

    // Store company name and user name for onboarding
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('vantro_company_name', companyName)
      sessionStorage.setItem('vantro_your_name', yourName)
    }

    router.push('/signup/verify')
  }

  return (
    <div className="min-h-screen bg-[#0f1923] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">

        {/* Logo */}
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
          <p className="text-[#4d6478] text-sm mt-2">Start your free 30-day trial</p>
        </div>

        <div className="bg-[#1a2635] border border-white/5 rounded-2xl p-8">
          <h1 className="text-xl font-semibold mb-6">Create your account</h1>

          <form onSubmit={handleSignup} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#8fa3b8] mb-2">Company name</label>
              <input
                type="text"
                value={companyName}
                onChange={e => setCompanyName(e.target.value)}
                placeholder="e.g. Smith Glazing Ltd"
                required
                className="w-full bg-[#243040] border border-white/5 rounded-xl px-4 py-3 text-white placeholder-[#4d6478] focus:outline-none focus:border-[#00d4a0]/40 text-sm transition-colors"
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
                className="w-full bg-[#243040] border border-white/5 rounded-xl px-4 py-3 text-white placeholder-[#4d6478] focus:outline-none focus:border-[#00d4a0]/40 text-sm transition-colors"
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
                className="w-full bg-[#243040] border border-white/5 rounded-xl px-4 py-3 text-white placeholder-[#4d6478] focus:outline-none focus:border-[#00d4a0]/40 text-sm transition-colors"
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
                className="w-full bg-[#243040] border border-white/5 rounded-xl px-4 py-3 text-white placeholder-[#4d6478] focus:outline-none focus:border-[#00d4a0]/40 text-sm transition-colors"
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
              {loading ? 'Creating account...' : 'Start free trial'}
            </button>

            <p className="text-xs text-[#4d6478] text-center">
              30 days free. No credit card required. Cancel any time.
            </p>
          </form>
        </div>

        <p className="text-center text-sm text-[#4d6478] mt-6">
          Already have an account?{' '}
          <Link href="/login" className="text-[#00d4a0] hover:text-[#00a87e] transition-colors">Sign in</Link>
        </p>

      </div>
    </div>
  )
}
