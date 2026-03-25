'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function InstallerPage() {
  const router = useRouter()
  const [pin, setPin] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [shake, setShake] = useState(false)

  useEffect(() => {
    if (pin.length === 4) {
      verifyPin()
    }
  }, [pin])

  async function verifyPin() {
    setLoading(true)
    setError('')
    const res = await fetch('/api/installer/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin })
    })
    const data = await res.json()
    if (res.ok && data.token) {
      localStorage.setItem('vantro_installer_token', data.token)
      localStorage.setItem('vantro_installer_id', data.userId)
      localStorage.setItem('vantro_installer_name', data.name)
      localStorage.setItem('vantro_company_id', data.companyId)
      router.push('/installer/jobs')
    } else {
      setShake(true)
      setError(data.error || 'Incorrect PIN')
      setPin('')
      setTimeout(() => setShake(false), 500)
    }
    setLoading(false)
  }

  function pressKey(key: string) {
    if (loading) return
    if (key === 'del') {
      setPin(p => p.slice(0, -1))
      setError('')
    } else if (pin.length < 4) {
      setPin(p => p + key)
    }
  }

  const keys = ['1','2','3','4','5','6','7','8','9','','0','del']

  return (
    <div className="min-h-screen bg-[#0f1923] flex items-center justify-center px-4">
      <div className="w-full max-w-xs">

        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-[#00d4a0] flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                <rect x="2" y="2" width="7" height="7" rx="1.5" fill="#0f1923"/>
                <rect x="11" y="2" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.7"/>
                <rect x="2" y="11" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.7"/>
                <rect x="11" y="11" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.4"/>
              </svg>
            </div>
            <span className="text-lg font-semibold text-white">Van<span className="text-[#00d4a0]">tro</span></span>
          </div>
          <p className="text-[#4d6478] text-sm">Enter your PIN to sign in</p>
        </div>

        {/* PIN dots */}
        <div className={`flex justify-center gap-4 mb-8 transition-transform ${shake ? 'animate-bounce' : ''}`}>
          {[0,1,2,3].map(i => (
            <div key={i} className={`w-4 h-4 rounded-full border-2 transition-all ${
              i < pin.length
                ? 'bg-[#00d4a0] border-[#00d4a0]'
                : 'border-[#4d6478] bg-transparent'
            }`}/>
          ))}
        </div>

        {/* Error */}
        {error && (
          <p className="text-center text-sm text-red-400 mb-4">{error}</p>
        )}

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-3">
          {keys.map((key, i) => (
            <button
              key={i}
              onClick={() => key && pressKey(key)}
              disabled={loading || !key}
              className={`h-16 rounded-2xl text-xl font-medium transition-all active:scale-95 ${
                !key ? 'invisible' :
                key === 'del'
                  ? 'bg-[#1a2635] text-[#8fa3b8] text-base'
                  : 'bg-[#1a2635] hover:bg-[#243040] text-white border border-white/5'
              }`}
            >
              {key === 'del' ? (
                <svg className="mx-auto" width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z" stroke="currentColor" stroke-width="1.5"/>
                  <path d="M18 9l-6 6M12 9l6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
              ) : key}
            </button>
          ))}
        </div>

        <p className="text-center text-xs text-[#4d6478] mt-8">
          Forgotten your PIN? Contact your manager.
        </p>
      </div>
    </div>
  )
}
