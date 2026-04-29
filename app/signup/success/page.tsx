'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function SignupSuccessPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const sessionId = searchParams.get('session_id')
  const [status, setStatus] = useState<'waiting' | 'ready' | 'error' | 'timeout'>('waiting')
  const [attempts, setAttempts] = useState(0)

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()
    const MAX_ATTEMPTS = 30 // 30 attempts × 1s = 30 seconds max wait

    async function poll() {
      let i = 0
      while (i < MAX_ATTEMPTS && !cancelled) {
        i++
        setAttempts(i)
        try {
          // Check if user is signed in (the webhook should also have provisioned them)
          const { data: { user } } = await supabase.auth.getUser()
          if (!user) {
            // Not signed in yet — try to sign them in via the session
            // Webhook may still be processing — wait
            await new Promise(r => setTimeout(r, 1000))
            continue
          }

          // User exists — check for company
          const { data } = await supabase
            .from('users')
            .select('company_id')
            .eq('auth_user_id', user.id)
            .maybeSingle()

          if (data?.company_id) {
            setStatus('ready')
            // Onboarding now skips company step — go straight to team
            setTimeout(() => router.push('/onboarding?step=team'), 800)
            return
          }
        } catch (err) {
          console.error('Poll error:', err)
        }
        await new Promise(r => setTimeout(r, 1000))
      }
      if (!cancelled) setStatus('timeout')
    }

    if (sessionId) {
      poll()
    } else {
      setStatus('error')
    }

    return () => { cancelled = true }
  }, [sessionId, router])

  return (
    <div className="min-h-screen bg-[#0f1923] flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <div className="inline-flex items-center gap-2 mb-8">
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

        <div className="bg-[#1a2635] border border-white/5 rounded-2xl p-8">
          {status === 'waiting' && (
            <>
              <div className="w-12 h-12 mx-auto mb-5 border-2 border-[#00d4a0] border-t-transparent rounded-full animate-spin"/>
              <h1 className="text-xl font-semibold text-white mb-2">Setting up your account…</h1>
              <p className="text-[#4d6478] text-sm">Payment confirmed. Provisioning your dashboard.</p>
              {attempts > 10 && (
                <p className="text-[#4d6478] text-xs mt-4">
                  Taking longer than expected. Don't refresh.
                </p>
              )}
            </>
          )}

          {status === 'ready' && (
            <>
              <div className="w-16 h-16 rounded-full bg-[#00d4a0]/10 border border-[#00d4a0]/20 flex items-center justify-center mx-auto mb-5">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                  <path d="M20 6L9 17l-5-5" stroke="#00d4a0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <h1 className="text-xl font-semibold text-white mb-2">All set!</h1>
              <p className="text-[#4d6478] text-sm">Taking you to set up your team…</p>
            </>
          )}

          {status === 'timeout' && (
            <>
              <h1 className="text-xl font-semibold text-white mb-2">Almost there</h1>
              <p className="text-[#4d6478] text-sm mb-4">
                Your payment went through but provisioning is taking longer than usual.
                Try signing in directly.
              </p>
              <button
                onClick={() => router.push('/login')}
                className="w-full bg-[#00d4a0] hover:bg-[#00a87e] text-[#0f1923] font-semibold rounded-xl py-3 text-sm"
              >
                Sign in
              </button>
            </>
          )}

          {status === 'error' && (
            <>
              <h1 className="text-xl font-semibold text-white mb-2">Something went wrong</h1>
              <p className="text-[#4d6478] text-sm mb-4">No checkout session found. Please try signing up again.</p>
              <button
                onClick={() => router.push('/signup')}
                className="w-full bg-[#00d4a0] hover:bg-[#00a87e] text-[#0f1923] font-semibold rounded-xl py-3 text-sm"
              >
                Back to signup
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
