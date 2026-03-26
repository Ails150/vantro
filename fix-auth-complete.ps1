# Fix 1: admin page - better onboarding detection
$adminPage = @'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AdminDashboard from '@/components/admin/AdminDashboard'

export default async function AdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('id, company_id, name, role')
    .eq('auth_user_id', user.id)
    .eq('role', 'admin')
    .single()

  if (!userData || !userData.company_id) {
    redirect('/onboarding')
  }

  const companyId = userData.company_id

  const { data: jobs } = await supabase.from('jobs').select('*').eq('company_id', companyId).order('created_at', { ascending: false })
  const today = new Date(); today.setHours(0,0,0,0)
  const { data: signins } = await supabase.from('signins').select('*, users(name, initials)').eq('company_id', companyId).gte('signed_in_at', today.toISOString()).is('signed_out_at', null)
  const { data: alerts } = await supabase.from('alerts').select('*, jobs(name)').eq('company_id', companyId).eq('is_read', false).order('created_at', { ascending: false }).limit(10)
  const { data: pendingQA } = await supabase.from('qa_submissions').select('*, jobs(name), users(name, initials)').eq('company_id', companyId).eq('state', 'submitted').order('submitted_at', { ascending: false })
  const { data: teamMembers } = await supabase.from('users').select('*').eq('company_id', companyId)

  return (
    <AdminDashboard
      user={user}
      userData={userData}
      jobs={jobs || []}
      signins={signins || []}
      alerts={alerts || []}
      pendingQA={pendingQA || []}
      teamMembers={teamMembers || []}
    />
  )
}
'@
Set-Content -Path "app\admin\page.tsx" -Value $adminPage -Encoding UTF8

# Fix 2: onboarding - detect existing company and skip
$onboarding = @'
'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Step = 'company' | 'installers' | 'jobs' | 'done'

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('company')
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [installers, setInstallers] = useState([{ name: '', email: '' }])
  const [jobs, setJobs] = useState([{ name: '', address: '' }])

  useEffect(() => {
    async function checkExisting() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      const { data } = await supabase.from('users').select('company_id').eq('auth_user_id', user.id).eq('role', 'admin').single()
      if (data?.company_id) { router.push('/admin'); return }
      setChecking(false)
    }
    checkExisting()
  }, [])

  async function saveCompany() {
    if (!companyName.trim()) { setError('Enter your company name'); return }
    setLoading(true); setError('')
    const slug = companyName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) + '_' + Math.random().toString(36).slice(2, 6)
    const res = await fetch('/api/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ step: 'company', companyName, companySlug: slug }) })
    const data = await res.json()
    if (!res.ok) { setError(data.error); setLoading(false); return }
    setStep('installers'); setLoading(false)
  }

  async function saveInstallers() {
    setLoading(true); setError('')
    const valid = installers.filter(i => i.name && i.email)
    if (!valid.length) { setError('Add at least one installer'); setLoading(false); return }
    const res = await fetch('/api/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ step: 'installers', installers: valid }) })
    const data = await res.json()
    if (!res.ok) { setError(data.error); setLoading(false); return }
    setStep('jobs'); setLoading(false)
  }

  async function saveJobs() {
    setLoading(true); setError('')
    const valid = jobs.filter(j => j.name && j.address)
    const res = await fetch('/api/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ step: 'jobs', jobs: valid }) })
    const data = await res.json()
    if (!res.ok) { setError(data.error); setLoading(false); return }
    setStep('done'); setLoading(false)
  }

  if (checking) return (
    <div className="min-h-screen bg-[#0f1923] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-[#00d4a0] border-t-transparent rounded-full animate-spin"/>
    </div>
  )

  const stepIdx = ['company','installers','jobs','done'].indexOf(step)

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
            {['Company','Team','Jobs'].map((label, i) => (
              <div key={label} className="flex items-center gap-2 flex-1 last:flex-none">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 transition-all ${i < stepIdx ? 'bg-[#00d4a0] text-[#0f1923]' : i === stepIdx ? 'border-2 border-[#00d4a0] text-[#00d4a0]' : 'border-2 border-white/10 text-[#4d6478]'}`}>{i < stepIdx ? '✓' : i + 1}</div>
                <span className={`text-sm ${i === stepIdx ? 'text-white font-medium' : 'text-[#4d6478]'}`}>{label}</span>
                {i < 2 && <div className="flex-1 h-px bg-white/5"/>}
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
              <input value={companyName} onChange={e => setCompanyName(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveCompany()} placeholder="e.g. Smith Glazing Ltd" autoFocus className="w-full bg-[#243040] border border-white/5 rounded-xl px-4 py-3.5 text-white placeholder-[#4d6478] focus:outline-none focus:border-[#00d4a0]/40 text-sm mb-4"/>
              {error && <p className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-3 mb-4">{error}</p>}
              <button onClick={saveCompany} disabled={loading || !companyName.trim()} className="w-full bg-[#00d4a0] hover:bg-[#00a87e] disabled:opacity-40 text-[#0f1923] font-semibold rounded-xl py-3.5 text-sm transition-colors">{loading ? 'Saving...' : 'Continue'}</button>
            </div>
          )}

          {step === 'installers' && (
            <div>
              <h1 className="text-xl font-semibold mb-1">Add your team</h1>
              <p className="text-[#4d6478] text-sm mb-6">Each person gets an email to set their PIN and download the app.</p>
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {installers.map((inst, i) => (
                  <div key={i} className="flex gap-2">
                    <input value={inst.name} onChange={e => { const u=[...installers]; u[i]={...u[i],name:e.target.value}; setInstallers(u) }} placeholder="Full name" className="flex-1 bg-[#243040] border border-white/5 rounded-lg px-3 py-2.5 text-white placeholder-[#4d6478] focus:outline-none focus:border-[#00d4a0]/40 text-sm"/>
                    <input value={inst.email} onChange={e => { const u=[...installers]; u[i]={...u[i],email:e.target.value}; setInstallers(u) }} placeholder="Email" type="email" className="flex-1 bg-[#243040] border border-white/5 rounded-lg px-3 py-2.5 text-white placeholder-[#4d6478] focus:outline-none focus:border-[#00d4a0]/40 text-sm"/>
                    {installers.length > 1 && <button onClick={() => setInstallers(installers.filter((_,idx)=>idx!==i))} className="text-[#4d6478] hover:text-red-400 px-2">-</button>}
                  </div>
                ))}
              </div>
              <button onClick={() => setInstallers([...installers,{name:'',email:''}])} className="mt-3 text-sm text-[#00d4a0] flex items-center gap-1">+ Add another person</button>
              {error && <p className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-3 mt-4">{error}</p>}
              <div className="flex gap-3 mt-6">
                <button onClick={() => setStep('company')} className="flex-1 bg-[#243040] text-[#8fa3b8] rounded-xl py-3 text-sm">Back</button>
                <button onClick={saveInstallers} disabled={loading} className="flex-[2] bg-[#00d4a0] hover:bg-[#00a87e] disabled:opacity-40 text-[#0f1923] font-semibold rounded-xl py-3 text-sm transition-colors">{loading ? 'Saving...' : 'Continue'}</button>
              </div>
            </div>
          )}

          {step === 'jobs' && (
            <div>
              <h1 className="text-xl font-semibold mb-1">Add your active jobs</h1>
              <p className="text-[#4d6478] text-sm mb-6">Add more any time from your dashboard.</p>
              <div className="space-y-2">
                {jobs.map((job, i) => (
                  <div key={i} className="flex gap-2">
                    <input value={job.name} onChange={e => { const u=[...jobs]; u[i]={...u[i],name:e.target.value}; setJobs(u) }} placeholder="Job name" className="flex-1 bg-[#243040] border border-white/5 rounded-lg px-3 py-2.5 text-white placeholder-[#4d6478] focus:outline-none focus:border-[#00d4a0]/40 text-sm"/>
                    <input value={job.address} onChange={e => { const u=[...jobs]; u[i]={...u[i],address:e.target.value}; setJobs(u) }} placeholder="Site address" className="flex-1 bg-[#243040] border border-white/5 rounded-lg px-3 py-2.5 text-white placeholder-[#4d6478] focus:outline-none focus:border-[#00d4a0]/40 text-sm"/>
                    {jobs.length > 1 && <button onClick={() => setJobs(jobs.filter((_,idx)=>idx!==i))} className="text-[#4d6478] hover:text-red-400 px-2">-</button>}
                  </div>
                ))}
              </div>
              <button onClick={() => setJobs([...jobs,{name:'',address:''}])} className="mt-3 text-sm text-[#00d4a0] flex items-center gap-1">+ Add another job</button>
              {error && <p className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-3 mt-4">{error}</p>}
              <div className="flex gap-3 mt-6">
                <button onClick={() => setStep('installers')} className="flex-1 bg-[#243040] text-[#8fa3b8] rounded-xl py-3 text-sm">Back</button>
                <button onClick={saveJobs} disabled={loading} className="flex-[2] bg-[#00d4a0] hover:bg-[#00a87e] disabled:opacity-40 text-[#0f1923] font-semibold rounded-xl py-3 text-sm transition-colors">{loading ? 'Saving...' : 'Go to dashboard'}</button>
              </div>
            </div>
          )}

          {step === 'done' && (
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-[#00d4a0]/10 border border-[#00d4a0]/20 flex items-center justify-center mx-auto mb-5">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="#00d4a0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
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
'@
Set-Content -Path "app\onboarding\page.tsx" -Value $onboarding -Encoding UTF8

# Fix 3: signup page styling
$signup = @'
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
  const [done, setDone] = useState(false)

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    setLoading(true); setError('')
    const supabase = createClient()
    const { error: authError } = await supabase.auth.signUp({
      email, password,
      options: { data: { company_name: companyName, full_name: yourName }, emailRedirectTo: `${window.location.origin}/auth/callback` }
    })
    if (authError) { setError(authError.message); setLoading(false); return }
    setDone(true)
    setLoading(false)
  }

  if (done) return (
    <div className="min-h-screen bg-[#0f1923] flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <div className="inline-flex items-center gap-2 mb-8">
          <div className="w-8 h-8 rounded-lg bg-[#00d4a0] flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none"><rect x="2" y="2" width="7" height="7" rx="1.5" fill="#0f1923"/><rect x="11" y="2" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.7"/><rect x="2" y="11" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.7"/><rect x="11" y="11" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.4"/></svg>
          </div>
          <span className="text-xl font-semibold text-white">Van<span className="text-[#00d4a0]">tro</span></span>
        </div>
        <div className="bg-[#1a2635] border border-white/5 rounded-2xl p-8">
          <div className="w-16 h-16 rounded-full bg-[#00d4a0]/10 border border-[#00d4a0]/20 flex items-center justify-center mx-auto mb-5">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" stroke="#00d4a0" stroke-width="1.5"/><path d="M22 6l-10 7L2 6" stroke="#00d4a0" stroke-width="1.5" stroke-linecap="round"/></svg>
          </div>
          <h1 className="text-xl font-semibold text-white mb-2">Check your email</h1>
          <p className="text-[#4d6478] text-sm mb-4">We sent a confirmation link to <strong className="text-white">{email}</strong>. Click it to activate your account.</p>
          <p className="text-xs text-[#4d6478]">Check your spam folder if you do not see it.</p>
        </div>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#0f1923] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#00d4a0] flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none"><rect x="2" y="2" width="7" height="7" rx="1.5" fill="#0f1923"/><rect x="11" y="2" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.7"/><rect x="2" y="11" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.7"/><rect x="11" y="11" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.4"/></svg>
            </div>
            <span className="text-xl font-semibold text-white">Van<span className="text-[#00d4a0]">tro</span></span>
          </Link>
          <p className="text-[#4d6478] text-sm mt-2">30-day free trial. No credit card.</p>
        </div>

        <div className="bg-[#1a2635] border border-white/5 rounded-2xl p-8">
          <h1 className="text-xl font-semibold text-white mb-6">Create your account</h1>
          <form onSubmit={handleSignup} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#8fa3b8] mb-2">Company name</label>
              <input type="text" value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="e.g. Smith Glazing Ltd" required className="w-full bg-[#243040] border border-white/5 rounded-xl px-4 py-3 text-white placeholder-[#4d6478] focus:outline-none focus:border-[#00d4a0]/40 text-sm transition-colors"/>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#8fa3b8] mb-2">Your name</label>
              <input type="text" value={yourName} onChange={e => setYourName(e.target.value)} placeholder="John Smith" required className="w-full bg-[#243040] border border-white/5 rounded-xl px-4 py-3 text-white placeholder-[#4d6478] focus:outline-none focus:border-[#00d4a0]/40 text-sm transition-colors"/>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#8fa3b8] mb-2">Work email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="john@smithglazing.com" required className="w-full bg-[#243040] border border-white/5 rounded-xl px-4 py-3 text-white placeholder-[#4d6478] focus:outline-none focus:border-[#00d4a0]/40 text-sm transition-colors"/>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#8fa3b8] mb-2">Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" required className="w-full bg-[#243040] border border-white/5 rounded-xl px-4 py-3 text-white placeholder-[#4d6478] focus:outline-none focus:border-[#00d4a0]/40 text-sm transition-colors"/>
            </div>
            {error && <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-3">{error}</p>}
            <button type="submit" disabled={loading} className="w-full bg-[#00d4a0] hover:bg-[#00a87e] disabled:opacity-50 text-[#0f1923] font-semibold rounded-xl py-3 text-sm transition-colors">{loading ? 'Creating account...' : 'Start free trial'}</button>
            <p className="text-xs text-[#4d6478] text-center">30 days free. No credit card. Cancel any time.</p>
          </form>
        </div>

        <p className="text-center text-sm text-[#4d6478] mt-6">Already have an account? <Link href="/login" className="text-[#00d4a0] hover:text-[#00a87e] transition-colors">Sign in</Link></p>
      </div>
    </div>
  )
}
'@
Set-Content -Path "app\signup\page.tsx" -Value $signup -Encoding UTF8

Write-Host "Done" -ForegroundColor Green
