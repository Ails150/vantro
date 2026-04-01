'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function SetPasswordPage() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  async function handleSet() {
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    if (password !== confirm) { setError('Passwords do not match'); return }
    setLoading(true); setError('')
    const supabase = createClient()
    const { error: e } = await supabase.auth.updateUser({ password })
    if (e) { setError(e.message); setLoading(false); return }
    router.push('/admin')
  }

  return (
    <div className="min-h-screen bg-[#0f1923] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#00d4a0] flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none"><rect x="2" y="2" width="7" height="7" rx="1.5" fill="#0f1923"/><rect x="11" y="2" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.7"/><rect x="2" y="11" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.7"/><rect x="11" y="11" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.4"/></svg>
            </div>
            <span className="text-white text-xl font-semibold">Van<span className="text-[#00d4a0]">tro</span></span>
          </div>
        </div>
        <div className="bg-[#1a2635] border border-white/5 rounded-2xl p-8">
          <h1 className="text-white text-xl font-semibold mb-1">Set your password</h1>
          <p className="text-[#4d6478] text-sm mb-6">Choose a password to access your Vantro dashboard.</p>
          <div className="space-y-3">
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password (min 8 characters)" className="w-full bg-[#243040] border border-white/5 rounded-xl px-4 py-3 text-white placeholder-[#4d6478] focus:outline-none focus:border-[#00d4a0]/40 text-sm"/>
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Confirm password" className="w-full bg-[#243040] border border-white/5 rounded-xl px-4 py-3 text-white placeholder-[#4d6478] focus:outline-none focus:border-[#00d4a0]/40 text-sm"/>
          </div>
          {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
          <button onClick={handleSet} disabled={loading} className="w-full mt-5 bg-[#00d4a0] hover:bg-[#00a87e] disabled:opacity-40 text-[#0f1923] font-semibold rounded-xl py-3 text-sm transition-colors">
            {loading ? 'Setting password...' : 'Set password and go to dashboard'}
          </button>
        </div>
      </div>
    </div>
  )
}
