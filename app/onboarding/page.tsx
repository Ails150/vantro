'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Step = 'company' | 'installers' | 'done'

export default function OnboardingPage() {
  const router = useRouter()
  // FIX: start at 'company' — the first step. Was incorrectly 'installers'.
  const [step, setStep] = useState<Step>('company')
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [installers, setInstallers] = useState([{ name: '', email: '', role: 'installer' }])

  useEffect(() => {
    async function checkExisting() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      // Pre-fill from signup metadata if present
      const metaCompany = user.user_metadata?.company_name
      if (metaCompany) setCompanyName(metaCompany)

      // Skip onboarding if user already has an admin company
      const { data } = await supabase
        .from('users')
        .select('company_id')
        .eq('auth_user_id', user.id)
        .eq('role', 'admin')
        .maybeSingle()
      if (data?.company_id) { router.push('/admin'); return }

      setChecking(false)
    }
    checkExisting()
  }, [router])

  async function saveCompany() {
    if (!companyName.trim()) {
      setError('Please enter your company name')
      return
    }
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 'company', companyName: companyName.trim() })
      })
      const data = await res.json()

      if (!res.ok) {
        // Show the real error with detail if available
        const msg = data.detail
          ? `${data.error}: ${data.detail}`
          : data.error || 'Could not create company. Please try again.'
        setError(msg)
        return
      }

      // ONLY advance step on confirmed success
      setStep('installers')
    } catch (err: any) {
      setError(err?.message || 'Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function saveInstallers() {
    const valid = installers.filter(i => i.name.trim() && i.email.trim())
    if (!valid.length) {
      setError('Add at least one team member with name and email')
      return
    }

    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 'installers', installers: valid })
      })
      const data = await res.json()

      if (!res.ok) {
        // Status 412 means we somehow lost the company — go back to company step
        if (res.status === 412 || data.code === 'PRECONDITION_FAILED') {
          setError('Please complete the Company step first')
          setStep('company')
          return
        }
        const msg = data.detail
          ? `${data.error}: ${data.detail}`
          : data.error || 'Could not add team. Please try again.'
        setError(msg)
        return
      }

      // Send invite emails — don't block on these, but log failures
      const inviteResults = await Promise.allSettled(
        valid.map(inst =>
          fetch('/api/invite', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: inst.email, name: inst.name, role: inst.role || 'installer' })
          }).then(r => {
            if (!r.ok) throw new Error(`Invite failed for ${inst.email}`)
            return r
          })
        )
      )
      const failed = inviteResults.filter(r => r.status === 'rejected').length
      if (failed > 0) {
        console.warn(`${failed} invite email(s) failed to send — admin can resend from Team page`)
      }

      setStep('done')
    } catch (err: any) {
      setError(err?.message || 'Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (checking) return (
    <div className="min-h-screen bg-[#0f1923] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-[#00d4a0] border-t-transparent rounded-full animate-spin"/>
    </div>
  )

  const stepIdx = ['company','installers','done'].indexOf(step)

  return (
    <div className="min-h-screen bg-[#0f1923] text-white flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#00d4a0] flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none"><rect x="2" y="2" width="7" height="7" rx="1.5" fill="#0f1923"/><rect x="11" y="2" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.7"/><rect x="2" y="11" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.7"/><rect x="11" y="11" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.4"/></svg>
            </div>
            <span className="text-xl font-semibold">Van<span className="text-[#00d4a0]">tro</span></span>
          </div>
        </div>

        {step !== 'done' && (
          <div className="flex items-center gap-2 mb-8">
            {['Company','Team'].map((label, i) => (
              <div key={label} className="flex items-center gap-2 flex-1 last:flex-none">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 transition-all ${i < stepIdx ? 'bg-[#00d4a0] text-[#0f1923]' : i === stepIdx ? 'border-2 border-[#00d4a0] text-[#00d4a0]' : 'border-2 border-white/10 text-[#4d6478]'}`}>{i < stepIdx ? '✓' : i + 1}</div>
                <span className={`text-sm ${i === stepIdx ? 'text-white font-medium' : 'text-[#4d6478]'}`}>{label}</span>
                {i < 1 && <div className="flex-1 h-px bg-white/5"/>}
              </div>
            ))}
          </div>
        )}

        <div className="bg-[#1a2635] border border-white/5 rounded-2xl p-8">
          {step === 'company' && (
            <div>
              <h1 className="text-2xl font-semibold mb-1">Welcome to Vantro</h1>
              <p className="text-[#4d6478] text-sm mb-8">Takes less than 5 minutes to set up.</p>
              <label className="block text-sm font-medium text-[#8fa3b8] mb-2">What is your company called?</label>
              <input
                value={companyName}
                onChange={e => { setCompanyName(e.target.value); if (error) setError('') }}
                onKeyDown={e => e.key === 'Enter' && !loading && saveCompany()}
                placeholder="e.g. Smith Glazing Ltd"
                autoFocus
                disabled={loading}
                className="w-full bg-[#243040] border border-white/5 rounded-xl px-4 py-3.5 text-white placeholder-[#4d6478] focus:outline-none focus:border-[#00d4a0]/40 text-sm mb-4 disabled:opacity-60"
              />
              {error && <p className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-3 mb-4">{error}</p>}
              <button
                onClick={saveCompany}
                disabled={loading || !companyName.trim()}
                className="w-full bg-[#00d4a0] hover:bg-[#00a87e] disabled:opacity-40 text-[#0f1923] font-semibold rounded-xl py-3.5 text-sm transition-colors"
              >
                {loading ? 'Saving…' : 'Continue'}
              </button>
            </div>
          )}

          {step === 'installers' && (
            <div>
              <h1 className="text-xl font-semibold mb-1">Add your team</h1>
              <p className="text-[#4d6478] text-sm mb-6">Each person gets an email to set their PIN and download the app.</p>
              <div className="space-y-4">
                {installers.map((inst, i) => (
                  <div key={i} className="bg-[#1e2d3d] border border-white/5 rounded-xl p-4 space-y-3">
                    <input value={inst.name} onChange={e => { const u=[...installers]; u[i]={...u[i],name:e.target.value}; setInstallers(u); if (error) setError('') }} placeholder="Full name" disabled={loading} className="w-full bg-[#243040] border border-white/5 rounded-lg px-3 py-2.5 text-white placeholder-[#4d6478] focus:outline-none focus:border-[#00d4a0]/40 text-sm disabled:opacity-60"/>
                    <input value={inst.email} onChange={e => { const u=[...installers]; u[i]={...u[i],email:e.target.value}; setInstallers(u); if (error) setError('') }} placeholder="Email" type="email" disabled={loading} className="w-full bg-[#243040] border border-white/5 rounded-lg px-3 py-2.5 text-white placeholder-[#4d6478] focus:outline-none focus:border-[#00d4a0]/40 text-sm disabled:opacity-60"/>
                    <select value={inst.role} onChange={e => { const u=[...installers]; u[i]={...u[i],role:e.target.value}; setInstallers(u) }} disabled={loading} className="w-full bg-[#243040] border border-white/5 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-[#00d4a0]/40 text-sm disabled:opacity-60"><option value="installer">Installer - PIN app access only</option><option value="foreman">Foreman - PIN app + alert emails</option></select>
                    {installers.length > 1 && <button onClick={() => setInstallers(installers.filter((_,idx)=>idx!==i))} disabled={loading} className="text-[#4d6478] hover:text-red-400 px-2 disabled:opacity-40">Remove</button>}
                  </div>
                ))}
              </div>
              <button onClick={() => setInstallers([...installers,{name:'',email:'',role:'installer'}])} disabled={loading} className="mt-3 text-sm text-[#00d4a0] flex items-center gap-1 disabled:opacity-40">+ Add another person</button>
              {error && <p className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-3 mt-4">{error}</p>}
              <div className="flex gap-3 mt-6">
                <button onClick={() => setStep('company')} disabled={loading} className="flex-1 bg-[#243040] text-[#8fa3b8] rounded-xl py-3 text-sm disabled:opacity-40">Back</button>
                <button onClick={saveInstallers} disabled={loading} className="flex-[2] bg-[#00d4a0] hover:bg-[#00a87e] disabled:opacity-40 text-[#0f1923] font-semibold rounded-xl py-3 text-sm transition-colors">{loading ? 'Saving…' : 'Continue'}</button>
              </div>
            </div>
          )}

          {step === 'done' && (
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-[#00d4a0]/10 border border-[#00d4a0]/20 flex items-center justify-center mx-auto mb-5">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="#00d4a0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <h1 className="text-2xl font-semibold mb-2">You are ready</h1>
              <p className="text-[#4d6478] text-sm mb-8 max-w-xs mx-auto">Your team will receive emails to set their PIN. Your dashboard is live.</p>
              <button onClick={() => window.location.href = '/admin'} className="w-full bg-[#00d4a0] hover:bg-[#00a87e] text-[#0f1923] font-semibold rounded-xl py-3.5 text-sm transition-colors">Open my dashboard</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
