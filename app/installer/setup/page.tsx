'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

function SetupForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const email = searchParams.get('email') || ''
  const [step, setStep] = useState<'password'|'pin'|'done'>('password')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [pin, setPin] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function setPasswordStep(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    setLoading(true); setError('')
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })
    if (error) { setError(error.message); setLoading(false); return }
    setStep('pin')
    setLoading(false)
  }

  async function setPinStep(e: React.FormEvent) {
    e.preventDefault()
    if (pin.length !== 4) { setError('PIN must be 4 digits'); return }
    setLoading(true); setError('')
    const res = await fetch('/api/installer/setup-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, pin })
    })
    if (!res.ok) { const d = await res.json(); setError(d.error); setLoading(false); return }
    setStep('done')
    setLoading(false)
    setTimeout(() => router.push('/installer'), 2000)
  }

  const inp = "w-full bg-[#1a2635] border border-white/5 rounded-xl px-4 py-3 text-white placeholder-[#4d6478] focus:outline-none focus:border-[#00d4a0]/40 text-sm"

  return (
    <div className="w-full max-w-sm">
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[#00d4a0] flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
              <rect x="2" y="2" width="7" height="7" rx="1.5" fill="#0f1923"/>
              <rect x="11" y="2" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.7"/>
              <rect x="2" y="11" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.7"/>
              <rect x="11" y="11" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.4"/>
            </svg>
          </div>
          <span className="text-xl font-semibold text-white">Van<span className="text-[#00d4a0]">tro</span></span>
        </div>
      </div>

      <div className="bg-[#1a2635] border border-white/5 rounded-2xl p-8">
        {step === 'password' && (
          <>
            <h1 className="text-lg font-semibold mb-1">Set your password</h1>
            <p className="text-sm text-[#4d6478] mb-6">Welcome to Vantro. Set a password for {email}</p>
            <form onSubmit={setPasswordStep} className="space-y-4">
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="New password" required minLength={8} className={inp}/>
              <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Confirm password" required className={inp}/>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <button type="submit" disabled={loading} className="w-full bg-[#00d4a0] hover:bg-[#00a87e] disabled:opacity-50 text-[#0f1923] font-semibold rounded-xl py-3 text-sm">
                {loading ? 'Setting password...' : 'Continue'}
              </button>
            </form>
          </>
        )}

        {step === 'pin' && (
          <>
            <h1 className="text-lg font-semibold mb-1">Set your PIN</h1>
            <p className="text-sm text-[#4d6478] mb-6">Choose a 4-digit PIN to sign in on site quickly.</p>
            <form onSubmit={setPinStep} className="space-y-4">
              <input type="number" value={pin} onChange={e => setPin(e.target.value.slice(0, 4))} placeholder="4-digit PIN" required className={inp}/>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <button type="submit" disabled={loading || pin.length !== 4} className="w-full bg-[#00d4a0] hover:bg-[#00a87e] disabled:opacity-50 text-[#0f1923] font-semibold rounded-xl py-3 text-sm">
                {loading ? 'Saving...' : 'Set PIN and finish'}
              </button>
            </form>
          </>
        )}

        {step === 'done' && (
          <div className="text-center py-4">
            <div className="w-14 h-14 rounded-full bg-[#00d4a0]/10 border border-[#00d4a0]/20 flex items-center justify-center mx-auto mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="#00d4a0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </div>
            <h1 className="text-lg font-semibold mb-2">All set</h1>
            <p className="text-sm text-[#4d6478]">Taking you to the installer app...</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default function InstallerSetupPage() {
  return (
    <div className="min-h-screen bg-[#0f1923] flex items-center justify-center px-4">
      <Suspense fallback={<div className="w-8 h-8 border-2 border-[#00d4a0] border-t-transparent rounded-full animate-spin"/>}>
        <SetupForm />
      </Suspense>
    </div>
  )
}
