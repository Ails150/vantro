# VANTRO — Onboarding Flow
# Creates: app/onboarding/page.tsx + app/api/onboarding/route.ts

New-Item -Path "app\onboarding" -ItemType Directory -Force | Out-Null
New-Item -Path "app\api\onboarding" -ItemType Directory -Force | Out-Null
New-Item -Path "app\api\installers" -ItemType Directory -Force | Out-Null
New-Item -Path "app\api\jobs" -ItemType Directory -Force | Out-Null

# app/onboarding/page.tsx
$onboarding = @'
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Step = 'company' | 'installers' | 'jobs' | 'done'

interface Installer {
  name: string
  email: string
  initials: string
}

interface Job {
  name: string
  address: string
}

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('company')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Company
  const [companyName, setCompanyName] = useState('')
  const [companySlug, setCompanySlug] = useState('')

  // Installers
  const [installers, setInstallers] = useState<Installer[]>([
    { name: '', email: '', initials: '' }
  ])

  // Jobs
  const [jobs, setJobs] = useState<Job[]>([
    { name: '', address: '' }
  ])

  function slugify(name: string) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)
  }

  function getInitials(name: string) {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
  }

  function addInstaller() {
    setInstallers([...installers, { name: '', email: '', initials: '' }])
  }

  function updateInstaller(i: number, field: keyof Installer, value: string) {
    const updated = [...installers]
    updated[i] = { ...updated[i], [field]: value }
    if (field === 'name') updated[i].initials = getInitials(value)
    setInstallers(updated)
  }

  function removeInstaller(i: number) {
    setInstallers(installers.filter((_, idx) => idx !== i))
  }

  function addJob() {
    setJobs([...jobs, { name: '', address: '' }])
  }

  function updateJob(i: number, field: keyof Job, value: string) {
    const updated = [...jobs]
    updated[i] = { ...updated[i], [field]: value }
    setJobs(updated)
  }

  function removeJob(i: number) {
    setJobs(jobs.filter((_, idx) => idx !== i))
  }

  async function saveCompany() {
    setLoading(true)
    setError('')
    const res = await fetch('/api/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step: 'company', companyName, companySlug })
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error); setLoading(false); return }
    setStep('installers')
    setLoading(false)
  }

  async function saveInstallers() {
    setLoading(true)
    setError('')
    const valid = installers.filter(i => i.name && i.email)
    if (!valid.length) { setError('Add at least one installer'); setLoading(false); return }
    const res = await fetch('/api/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step: 'installers', installers: valid })
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error); setLoading(false); return }
    setStep('jobs')
    setLoading(false)
  }

  async function saveJobs() {
    setLoading(true)
    setError('')
    const valid = jobs.filter(j => j.name && j.address)
    const res = await fetch('/api/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step: 'jobs', jobs: valid })
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error); setLoading(false); return }
    setStep('done')
    setLoading(false)
  }

  const steps = ['company', 'installers', 'jobs', 'done']
  const stepIdx = steps.indexOf(step)

  return (
    <div className="min-h-screen bg-[#0f1923] text-white flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-xl">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded-lg bg-[#00d4a0] flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                <rect x="2" y="2" width="7" height="7" rx="1.5" fill="#0f1923"/>
                <rect x="11" y="2" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.7"/>
                <rect x="2" y="11" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.7"/>
                <rect x="11" y="11" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.4"/>
              </svg>
            </div>
            <span className="text-xl font-semibold">Van<span className="text-[#00d4a0]">tro</span></span>
          </div>
        </div>

        {/* Progress */}
        {step !== 'done' && (
          <div className="flex items-center gap-2 mb-8">
            {['Company', 'Installers', 'Jobs'].map((label, i) => (
              <div key={label} className="flex items-center gap-2 flex-1">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 ${
                  i < stepIdx ? 'bg-[#00d4a0] text-[#0f1923]' :
                  i === stepIdx ? 'bg-[#00d4a0]/20 border border-[#00d4a0] text-[#00d4a0]' :
                  'bg-[#1a2635] text-[#4d6478]'
                }`}>{i < stepIdx ? '✓' : i + 1}</div>
                <span className={`text-xs ${i === stepIdx ? 'text-[#00d4a0]' : 'text-[#4d6478]'}`}>{label}</span>
                {i < 2 && <div className="flex-1 h-px bg-[#1a2635]"/>}
              </div>
            ))}
          </div>
        )}

        {/* STEP: Company */}
        {step === 'company' && (
          <div className="bg-[#1a2635] border border-white/5 rounded-2xl p-8">
            <h1 className="text-xl font-semibold mb-1">Set up your company</h1>
            <p className="text-[#4d6478] text-sm mb-6">This is what your team will see when they sign in.</p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#8fa3b8] mb-2">Company name</label>
                <input
                  value={companyName}
                  onChange={e => { setCompanyName(e.target.value); setCompanySlug(slugify(e.target.value)) }}
                  placeholder="e.g. i-Glaze Ltd"
                  className="w-full bg-[#243040] border border-white/5 rounded-xl px-4 py-3 text-white placeholder-[#4d6478] focus:outline-none focus:border-[#00d4a0]/40 text-sm transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#8fa3b8] mb-2">Your subdomain</label>
                <div className="flex items-center bg-[#243040] border border-white/5 rounded-xl overflow-hidden">
                  <input
                    value={companySlug}
                    onChange={e => setCompanySlug(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))}
                    placeholder="iglaze"
                    className="flex-1 bg-transparent px-4 py-3 text-white placeholder-[#4d6478] focus:outline-none text-sm"
                  />
                  <span className="px-4 text-[#4d6478] text-sm border-l border-white/5">.getvantro.com</span>
                </div>
              </div>
              {error && <p className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-3">{error}</p>}
              <button
                onClick={saveCompany}
                disabled={loading || !companyName || !companySlug}
                className="w-full bg-[#00d4a0] hover:bg-[#00a87e] disabled:opacity-40 text-[#0f1923] font-semibold rounded-xl py-3 text-sm transition-colors"
              >
                {loading ? 'Saving...' : 'Continue →'}
              </button>
            </div>
          </div>
        )}

        {/* STEP: Installers */}
        {step === 'installers' && (
          <div className="bg-[#1a2635] border border-white/5 rounded-2xl p-8">
            <h1 className="text-xl font-semibold mb-1">Add your installers</h1>
            <p className="text-[#4d6478] text-sm mb-6">Each installer gets an email to set their PIN and download the app.</p>
            <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
              {installers.map((inst, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <div className="flex-1 grid grid-cols-2 gap-2">
                    <input
                      value={inst.name}
                      onChange={e => updateInstaller(i, 'name', e.target.value)}
                      placeholder="Full name"
                      className="bg-[#243040] border border-white/5 rounded-lg px-3 py-2.5 text-white placeholder-[#4d6478] focus:outline-none focus:border-[#00d4a0]/40 text-sm"
                    />
                    <input
                      value={inst.email}
                      onChange={e => updateInstaller(i, 'email', e.target.value)}
                      placeholder="Email address"
                      type="email"
                      className="bg-[#243040] border border-white/5 rounded-lg px-3 py-2.5 text-white placeholder-[#4d6478] focus:outline-none focus:border-[#00d4a0]/40 text-sm"
                    />
                  </div>
                  {installers.length > 1 && (
                    <button onClick={() => removeInstaller(i)} className="text-[#4d6478] hover:text-red-400 transition-colors mt-2.5 flex-shrink-0">
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button onClick={addInstaller} className="mt-3 text-sm text-[#00d4a0] hover:text-[#00a87e] transition-colors flex items-center gap-1">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
              Add another installer
            </button>
            {error && <p className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-3 mt-4">{error}</p>}
            <div className="flex gap-3 mt-6">
              <button onClick={() => setStep('company')} className="flex-1 bg-[#243040] text-[#8fa3b8] font-medium rounded-xl py-3 text-sm">← Back</button>
              <button
                onClick={saveInstallers}
                disabled={loading}
                className="flex-2 bg-[#00d4a0] hover:bg-[#00a87e] disabled:opacity-40 text-[#0f1923] font-semibold rounded-xl py-3 text-sm transition-colors px-8"
              >
                {loading ? 'Saving...' : 'Continue →'}
              </button>
            </div>
          </div>
        )}

        {/* STEP: Jobs */}
        {step === 'jobs' && (
          <div className="bg-[#1a2635] border border-white/5 rounded-2xl p-8">
            <h1 className="text-xl font-semibold mb-1">Add your first jobs</h1>
            <p className="text-[#4d6478] text-sm mb-6">You can add more jobs from your dashboard at any time.</p>
            <div className="space-y-3">
              {jobs.map((job, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <div className="flex-1 grid grid-cols-2 gap-2">
                    <input
                      value={job.name}
                      onChange={e => updateJob(i, 'name', e.target.value)}
                      placeholder="Job name"
                      className="bg-[#243040] border border-white/5 rounded-lg px-3 py-2.5 text-white placeholder-[#4d6478] focus:outline-none focus:border-[#00d4a0]/40 text-sm"
                    />
                    <input
                      value={job.address}
                      onChange={e => updateJob(i, 'address', e.target.value)}
                      placeholder="Site address"
                      className="bg-[#243040] border border-white/5 rounded-lg px-3 py-2.5 text-white placeholder-[#4d6478] focus:outline-none focus:border-[#00d4a0]/40 text-sm"
                    />
                  </div>
                  {jobs.length > 1 && (
                    <button onClick={() => removeJob(i)} className="text-[#4d6478] hover:text-red-400 transition-colors mt-2.5 flex-shrink-0">
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button onClick={addJob} className="mt-3 text-sm text-[#00d4a0] hover:text-[#00a87e] transition-colors flex items-center gap-1">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
              Add another job
            </button>
            {error && <p className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-3 mt-4">{error}</p>}
            <div className="flex gap-3 mt-6">
              <button onClick={() => setStep('installers')} className="flex-1 bg-[#243040] text-[#8fa3b8] font-medium rounded-xl py-3 text-sm">← Back</button>
              <button
                onClick={saveJobs}
                disabled={loading}
                className="flex-2 bg-[#00d4a0] hover:bg-[#00a87e] disabled:opacity-40 text-[#0f1923] font-semibold rounded-xl py-3 text-sm transition-colors px-8"
              >
                {loading ? 'Saving...' : 'Finish setup →'}
              </button>
            </div>
          </div>
        )}

        {/* STEP: Done */}
        {step === 'done' && (
          <div className="bg-[#1a2635] border border-white/5 rounded-2xl p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-[#00d4a0]/10 border border-[#00d4a0]/20 flex items-center justify-center mx-auto mb-6">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <path d="M20 6L9 17l-5-5" stroke="#00d4a0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
            <h1 className="text-xl font-semibold mb-2">You are ready to go</h1>
            <p className="text-[#4d6478] text-sm mb-8">Your installers will receive an email to set their PIN and download the app. Your dashboard is ready.</p>
            <button
              onClick={() => router.push('/admin')}
              className="w-full bg-[#00d4a0] hover:bg-[#00a87e] text-[#0f1923] font-semibold rounded-xl py-3 text-sm transition-colors"
            >
              Go to dashboard →
            </button>
          </div>
        )}

      </div>
    </div>
  )
}
'@
Set-Content -Path "app\onboarding\page.tsx" -Value $onboarding -Encoding UTF8

# app/api/onboarding/route.ts
$apiRoute = @'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const body = await request.json()
  const { step } = body

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = await createServiceClient()

  if (step === 'company') {
    const { companyName, companySlug } = body

    // Create company
    const { data: company, error: compError } = await service
      .from('companies')
      .insert({ name: companyName, slug: companySlug })
      .select()
      .single()

    if (compError) return NextResponse.json({ error: compError.message }, { status: 400 })

    // Create admin user record
    const initials = companyName.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
    await service.from('users').insert({
      company_id: company.id,
      email: user.email,
      name: user.email?.split('@')[0] || 'Admin',
      initials,
      role: 'admin',
      auth_user_id: user.id
    })

    return NextResponse.json({ success: true, companyId: company.id })
  }

  if (step === 'installers') {
    const { installers } = body

    // Get company for this user
    const { data: userData } = await service
      .from('users')
      .select('company_id')
      .eq('auth_user_id', user.id)
      .single()

    if (!userData) return NextResponse.json({ error: 'Company not found' }, { status: 400 })

    const insertData = installers.map((inst: any) => ({
      company_id: userData.company_id,
      email: inst.email,
      name: inst.name,
      initials: inst.initials || inst.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2),
      role: 'installer',
    }))

    const { error } = await service.from('users').insert(insertData)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({ success: true })
  }

  if (step === 'jobs') {
    const { jobs } = body

    const { data: userData } = await service
      .from('users')
      .select('company_id')
      .eq('auth_user_id', user.id)
      .single()

    if (!userData) return NextResponse.json({ error: 'Company not found' }, { status: 400 })

    if (jobs && jobs.length > 0) {
      const insertData = jobs.map((job: any) => ({
        company_id: userData.company_id,
        name: job.name,
        address: job.address,
        status: 'active',
        created_by: user.id,
      }))
      await service.from('jobs').insert(insertData)
    }

    // Mark onboarding complete
    await service
      .from('companies')
      .update({ plan: 'trial' })
      .eq('id', userData.company_id)

    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Unknown step' }, { status: 400 })
}
'@
Set-Content -Path "app\api\onboarding\route.ts" -Value $apiRoute -Encoding UTF8

Write-Host "Onboarding flow created" -ForegroundColor Green
Write-Host "Files created:" -ForegroundColor Cyan
Write-Host "  app/onboarding/page.tsx" -ForegroundColor Cyan
Write-Host "  app/api/onboarding/route.ts" -ForegroundColor Cyan
