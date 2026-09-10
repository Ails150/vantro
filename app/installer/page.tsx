'use client'

/**
 * Field worker PIN login.
 *
 * This route is the entry point for every field worker, and it is where the
 * whole app sends anyone without a valid token (`router.push('/installer')`).
 *
 * It previously held a stale copy of the jobs page — same `InstallerJobsPage`
 * component, minus the later fixes — so landing here with no token bounced
 * straight back to `/installer` and spun forever. `/api/installer/auth` was
 * live the whole time with nothing calling it. Keep this file a login screen.
 */

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

const BG = '#0f1923'
const CARD = '#1a2635'
const ACCENT = '#00d4a0'
const MUTED = '#4d6478'

export default function InstallerLoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [forgotSent, setForgotSent] = useState(false)

  // An existing session skips the form. Verified against the API rather than
  // trusted from localStorage, so a revoked or expired token lands here
  // instead of on a jobs page that will bounce straight back.
  useEffect(() => {
    const token = localStorage.getItem('vantro_installer_token')
    if (!token) { setChecking(false); return }
    let cancelled = false
    fetch('/api/installer/jobs', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => {
        if (cancelled) return
        if (res.ok) { router.replace('/installer/jobs'); return }
        localStorage.removeItem('vantro_installer_token')
        localStorage.removeItem('vantro_installer_id')
        localStorage.removeItem('vantro_installer_name')
        setChecking(false)
      })
      .catch(() => { if (!cancelled) setChecking(false) })
    return () => { cancelled = true }
  }, [router])

  const savedEmail = typeof window !== 'undefined' ? localStorage.getItem('vantro_installer_email') : null
  useEffect(() => { if (savedEmail) setEmail(savedEmail) }, [savedEmail])

  async function handleLogin() {
    if (!email.trim()) { setError('Enter your email address.'); return }
    if (pin.length !== 4) { setError('Enter your 4-digit PIN.'); return }

    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/installer/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), pin }),
      })
      const data = await res.json()

      if (!res.ok) {
        // The route deliberately returns one message for both "no such email"
        // and "wrong PIN". Show what it sends rather than guessing which.
        setError(data.error || 'Incorrect email or PIN. Please try again.')
        setPin('')
        setLoading(false)
        return
      }

      localStorage.setItem('vantro_installer_token', data.token)
      localStorage.setItem('vantro_installer_id', data.userId)
      localStorage.setItem('vantro_installer_name', data.name || 'Field worker')
      // Remembered so the next login is PIN-only on a shared site phone.
      localStorage.setItem('vantro_installer_email', email.trim())

      router.replace('/installer/jobs')
    } catch {
      setError('Could not reach Vantro. Check your signal and try again.')
      setLoading(false)
    }
  }

  async function handleForgot() {
    if (!email.trim()) { setError('Enter your email address first.'); return }
    setError('')
    await fetch('/api/installer/reset-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim() }),
    }).catch(() => {})
    // The route answers the same way whether or not the address is known.
    setForgotSent(true)
  }

  if (checking) {
    return (
      <div style={{ minHeight: '100vh', background: BG, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 32, height: 32, border: `2px solid ${ACCENT}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: BG, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'system-ui,sans-serif' }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ width: 56, height: 56, background: ACCENT, borderRadius: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 700, color: BG, marginBottom: 16 }}>V</div>
          <h1 style={{ color: '#fff', fontSize: 22, fontWeight: 700, margin: 0 }}>Sign in</h1>
          <p style={{ color: MUTED, fontSize: 14, marginTop: 8 }}>Enter your email and 4-digit PIN</p>
        </div>

        <div style={{ background: CARD, borderRadius: 16, padding: 24 }}>
          <div style={{ marginBottom: 16 }}>
            <label htmlFor="installer-email" style={{ color: MUTED, fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>EMAIL</label>
            <input
              id="installer-email"
              value={email}
              onChange={e => { setEmail(e.target.value); setError('') }}
              type="email"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="username"
              placeholder="you@company.com"
              style={{ width: '100%', padding: '10px 12px', background: BG, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, color: '#fff', fontSize: 15, boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label htmlFor="installer-pin" style={{ color: MUTED, fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>PIN</label>
            <input
              id="installer-pin"
              value={pin}
              onChange={e => { setPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setError('') }}
              onKeyDown={e => { if (e.key === 'Enter') handleLogin() }}
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              maxLength={4}
              placeholder="4 digits"
              style={{ width: '100%', padding: '10px 12px', background: BG, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, color: '#fff', fontSize: 20, letterSpacing: 8, boxSizing: 'border-box' }}
            />
          </div>

          {error && <p role="alert" style={{ color: '#f87171', fontSize: 13, marginTop: 0, marginBottom: 12 }}>{error}</p>}
          {forgotSent && <p style={{ color: ACCENT, fontSize: 13, marginTop: 0, marginBottom: 12 }}>If that address has an account, a reset link is on its way.</p>}

          <button
            onClick={handleLogin}
            disabled={loading}
            style={{ width: '100%', padding: 12, background: ACCENT, color: BG, border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.6 : 1 }}
          >
            {loading ? 'Signing in...' : 'Sign in →'}
          </button>

          <button
            onClick={handleForgot}
            style={{ width: '100%', marginTop: 12, padding: 8, background: 'none', color: MUTED, border: 'none', fontSize: 13, cursor: 'pointer' }}
          >
            Forgot your PIN?
          </button>
        </div>
      </div>
    </div>
  )
}
