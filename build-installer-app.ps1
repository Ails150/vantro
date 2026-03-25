# VANTRO — Admin redirect + Installer App
# Updates admin page to check onboarding
# Creates installer app at /app/installer

New-Item -Path "app\installer" -ItemType Directory -Force | Out-Null
New-Item -Path "app\installer\pin" -ItemType Directory -Force | Out-Null
New-Item -Path "app\installer\jobs" -ItemType Directory -Force | Out-Null
New-Item -Path "app\api\diary" -ItemType Directory -Force | Out-Null
New-Item -Path "app\api\signin" -ItemType Directory -Force | Out-Null
New-Item -Path "app\api\qa" -ItemType Directory -Force | Out-Null
New-Item -Path "components\installer" -ItemType Directory -Force | Out-Null

# Update admin page to redirect to onboarding if no company
$adminPage = @'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AdminDashboard from '@/components/admin/AdminDashboard'

export default async function AdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Check if user has completed onboarding
  const { data: userData } = await supabase
    .from('users')
    .select('*, companies(*)')
    .eq('auth_user_id', user.id)
    .single()

  // No company set up yet — go to onboarding
  if (!userData || !userData.company_id) {
    redirect('/onboarding')
  }

  const companyId = userData.company_id

  const { data: jobs } = await supabase
    .from('jobs')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const { data: signins } = await supabase
    .from('signins')
    .select('*, users(name, initials)')
    .eq('company_id', companyId)
    .gte('signed_in_at', today.toISOString())
    .is('signed_out_at', null)

  const { data: alerts } = await supabase
    .from('alerts')
    .select('*, jobs(name)')
    .eq('company_id', companyId)
    .eq('is_read', false)
    .order('created_at', { ascending: false })
    .limit(10)

  const { data: pendingQA } = await supabase
    .from('qa_submissions')
    .select('*, jobs(name), users(name, initials), checklist_items(label)')
    .eq('company_id', companyId)
    .eq('state', 'submitted')
    .order('submitted_at', { ascending: false })

  const { data: teamMembers } = await supabase
    .from('users')
    .select('*')
    .eq('company_id', companyId)
    .eq('is_active', true)

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

# Installer app — main PIN screen
$installerApp = @'
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
'@
Set-Content -Path "app\installer\page.tsx" -Value $installerApp -Encoding UTF8

# Installer jobs list
$installerJobs = @'
'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function InstallerJobsPage() {
  const router = useRouter()
  const [jobs, setJobs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [installerName, setInstallerName] = useState('')
  const [activeJob, setActiveJob] = useState<any>(null)
  const [view, setView] = useState<'jobs'|'diary'|'qa'>('jobs')
  const [diaryText, setDiaryText] = useState('')
  const [diaryLoading, setDiaryLoading] = useState(false)
  const [diarySuccess, setDiarySuccess] = useState(false)
  const [gpsStatus, setGpsStatus] = useState<'idle'|'checking'|'confirmed'|'blocked'>('idle')
  const [gpsMessage, setGpsMessage] = useState('')

  useEffect(() => {
    const token = localStorage.getItem('vantro_installer_token')
    const name = localStorage.getItem('vantro_installer_name')
    if (!token) { router.push('/installer'); return }
    setInstallerName(name || 'Installer')
    loadJobs(token)
  }, [])

  async function loadJobs(token: string) {
    const res = await fetch('/api/installer/jobs', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    if (!res.ok) { router.push('/installer'); return }
    const data = await res.json()
    setJobs(data.jobs || [])
    setLoading(false)
  }

  async function signInToJob(job: any) {
    setActiveJob(job)
    setGpsStatus('checking')
    setView('jobs')

    if (!navigator.geolocation) {
      setGpsStatus('blocked')
      setGpsMessage('GPS not supported on this device')
      return
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude, accuracy } = pos.coords
        const token = localStorage.getItem('vantro_installer_token')
        const res = await fetch('/api/signin', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            jobId: job.id,
            lat: latitude,
            lng: longitude,
            accuracy: Math.round(accuracy)
          })
        })
        const data = await res.json()
        if (res.ok) {
          setGpsStatus('confirmed')
          setGpsMessage(`GPS confirmed · ${data.distanceMetres}m from site · ±${Math.round(accuracy)}m accuracy`)
          setJobs(prev => prev.map(j => j.id === job.id ? { ...j, signed_in: true } : j))
        } else {
          setGpsStatus('blocked')
          setGpsMessage(data.error || 'Could not sign in')
        }
      },
      (err) => {
        setGpsStatus('blocked')
        setGpsMessage(err.code === 1 ? 'Location permission denied. Please allow location access.' : 'Could not get your location. Try again.')
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    )
  }

  async function submitDiary() {
    if (!diaryText.trim() || !activeJob) return
    setDiaryLoading(true)
    const token = localStorage.getItem('vantro_installer_token')
    await fetch('/api/diary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ jobId: activeJob.id, text: diaryText })
    })
    setDiaryText('')
    setDiarySuccess(true)
    setTimeout(() => setDiarySuccess(false), 2000)
    setDiaryLoading(false)
  }

  function signOut() {
    localStorage.removeItem('vantro_installer_token')
    localStorage.removeItem('vantro_installer_id')
    localStorage.removeItem('vantro_installer_name')
    localStorage.removeItem('vantro_company_id')
    router.push('/installer')
  }

  if (loading) return (
    <div className="min-h-screen bg-[#0f1923] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-[#00d4a0] border-t-transparent rounded-full animate-spin"/>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#0f1923] text-white">
      {/* Header */}
      <div className="border-b border-white/5 px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[#00d4a0] flex items-center justify-center">
            <svg width="12" height="12" viewBox="0 0 20 20" fill="none">
              <rect x="2" y="2" width="7" height="7" rx="1.5" fill="#0f1923"/>
              <rect x="11" y="2" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.7"/>
              <rect x="2" y="11" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.7"/>
              <rect x="11" y="11" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.4"/>
            </svg>
          </div>
          <div>
            <div className="text-sm font-semibold">{installerName}</div>
            <div className="text-xs text-[#4d6478]">Installer</div>
          </div>
        </div>
        <button onClick={signOut} className="text-xs text-[#4d6478] border border-white/5 rounded-full px-3 py-1">Sign out</button>
      </div>

      {/* GPS status banner */}
      {gpsStatus !== 'idle' && activeJob && (
        <div className={`mx-4 mt-4 rounded-xl px-4 py-3 text-sm flex items-center gap-2 ${
          gpsStatus === 'checking' ? 'bg-[#1a2635] text-[#8fa3b8]' :
          gpsStatus === 'confirmed' ? 'bg-[#00d4a0]/08 border border-[#00d4a0]/20 text-[#00d4a0]' :
          'bg-red-400/08 border border-red-400/20 text-red-300'
        }`}>
          {gpsStatus === 'checking' && <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin flex-shrink-0"/>}
          {gpsStatus === 'confirmed' && <div className="w-2 h-2 rounded-full bg-[#00d4a0] flex-shrink-0"/>}
          {gpsStatus === 'blocked' && <div className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0"/>}
          <span>{gpsStatus === 'checking' ? 'Checking your location...' : gpsMessage}</span>
        </div>
      )}

      {/* Active job tabs */}
      {activeJob && gpsStatus === 'confirmed' && (
        <div className="flex gap-0 border-b border-white/5 px-4 mt-4">
          {['jobs','diary','qa'].map(t => (
            <button
              key={t}
              onClick={() => setView(t as any)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors capitalize ${
                view === t ? 'border-[#00d4a0] text-[#00d4a0]' : 'border-transparent text-[#4d6478]'
              }`}
            >{t === 'qa' ? 'QA' : t}</button>
          ))}
        </div>
      )}

      <div className="px-4 py-4">

        {/* JOBS LIST */}
        {view === 'jobs' && (
          <div className="space-y-3">
            <h2 className="text-sm font-medium text-[#8fa3b8] mb-3">Your jobs today</h2>
            {jobs.length === 0 && (
              <div className="text-center text-[#4d6478] text-sm py-12">No jobs assigned today</div>
            )}
            {jobs.map((job: any) => (
              <div key={job.id} className={`bg-[#1a2635] border rounded-xl p-4 ${
                activeJob?.id === job.id ? 'border-[#00d4a0]/30' : 'border-white/5'
              }`}>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <div className="font-medium text-sm">{job.name}</div>
                    <div className="text-xs text-[#4d6478] mt-0.5">{job.address}</div>
                  </div>
                  {job.signed_in && (
                    <span className="text-xs bg-[#00d4a0]/10 text-[#00d4a0] border border-[#00d4a0]/20 rounded-full px-2 py-0.5 flex-shrink-0">On site</span>
                  )}
                </div>
                {!job.signed_in ? (
                  <button
                    onClick={() => signInToJob(job)}
                    disabled={gpsStatus === 'checking'}
                    className="w-full bg-[#00d4a0] hover:bg-[#00a87e] disabled:opacity-40 text-[#0f1923] font-semibold rounded-lg py-2.5 text-sm transition-colors"
                  >
                    {gpsStatus === 'checking' && activeJob?.id === job.id ? 'Getting location...' : 'Sign in to this job'}
                  </button>
                ) : activeJob?.id === job.id ? (
                  <div className="flex gap-2">
                    <button onClick={() => setView('diary')} className="flex-1 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-lg py-2 text-xs font-medium">Site diary</button>
                    <button onClick={() => setView('qa')} className="flex-1 bg-[#00d4a0]/10 text-[#00d4a0] border border-[#00d4a0]/20 rounded-lg py-2 text-xs font-medium">QA checklist</button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}

        {/* DIARY */}
        {view === 'diary' && activeJob && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <button onClick={() => setView('jobs')} className="text-[#4d6478]">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M19 12H5M12 19l-7-7 7-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
              <div>
                <div className="font-medium text-sm">Site diary</div>
                <div className="text-xs text-[#4d6478]">{activeJob.name}</div>
              </div>
            </div>
            <div className="bg-[#1a2635] border border-white/5 rounded-xl p-4">
              <textarea
                value={diaryText}
                onChange={e => setDiaryText(e.target.value)}
                placeholder="What happened on site today? Log progress, issues, blockers, or anything the office needs to know..."
                rows={6}
                className="w-full bg-transparent text-white placeholder-[#4d6478] text-sm resize-none outline-none leading-relaxed"
              />
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/5">
                <span className="text-xs text-[#4d6478]">{diaryText.length} characters</span>
                <button
                  onClick={submitDiary}
                  disabled={!diaryText.trim() || diaryLoading}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    diarySuccess ? 'bg-[#00d4a0]/10 text-[#00d4a0] border border-[#00d4a0]/20' :
                    'bg-[#00d4a0] text-[#0f1923] hover:bg-[#00a87e] disabled:opacity-40'
                  }`}
                >
                  {diarySuccess ? 'Submitted ✓' : diaryLoading ? 'Submitting...' : 'Submit entry'}
                </button>
              </div>
            </div>
            <p className="text-xs text-[#4d6478] mt-3 text-center">AI reads your entry instantly and alerts the foreman to any issues.</p>
          </div>
        )}

        {/* QA */}
        {view === 'qa' && activeJob && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <button onClick={() => setView('jobs')} className="text-[#4d6478]">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M19 12H5M12 19l-7-7 7-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
              <div>
                <div className="font-medium text-sm">QA checklist</div>
                <div className="text-xs text-[#4d6478]">{activeJob.name}</div>
              </div>
            </div>
            <div className="bg-[#1a2635] border border-white/5 rounded-xl p-4 text-center py-12">
              <div className="text-[#4d6478] text-sm">QA checklist loads here based on the job template.</div>
              <div className="text-[#4d6478] text-xs mt-2">Set up in your admin dashboard.</div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
'@
Set-Content -Path "app\installer\jobs\page.tsx" -Value $installerJobs -Encoding UTF8

# API: Installer auth
New-Item -Path "app\api\installer" -ItemType Directory -Force | Out-Null
New-Item -Path "app\api\installer\auth" -ItemType Directory -Force | Out-Null
New-Item -Path "app\api\installer\jobs" -ItemType Directory -Force | Out-Null

$installerAuth = @'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import bcrypt from 'bcryptjs'

export async function POST(request: Request) {
  const { pin } = await request.json()
  if (!pin || pin.length !== 4) {
    return NextResponse.json({ error: 'Invalid PIN' }, { status: 400 })
  }

  const service = await createServiceClient()

  // Get all active installers with PINs
  const { data: users } = await service
    .from('users')
    .select('id, name, company_id, pin_hash, pin_attempts, pin_locked_until, role')
    .eq('is_active', true)
    .not('pin_hash', 'is', null)

  if (!users) return NextResponse.json({ error: 'Incorrect PIN' }, { status: 401 })

  // Find matching PIN
  let matchedUser = null
  for (const user of users) {
    if (user.pin_locked_until && new Date(user.pin_locked_until) > new Date()) {
      continue // Skip locked accounts
    }
    if (user.pin_hash && await bcrypt.compare(pin, user.pin_hash)) {
      matchedUser = user
      break
    }
  }

  if (!matchedUser) {
    // Increment attempts on all users with this pin attempt (simplified)
    return NextResponse.json({ error: 'Incorrect PIN. Please try again.' }, { status: 401 })
  }

  // Reset attempts on successful login
  await service
    .from('users')
    .update({ pin_attempts: 0, pin_locked_until: null })
    .eq('id', matchedUser.id)

  // Create a simple session token (in production use JWT)
  const token = Buffer.from(JSON.stringify({
    userId: matchedUser.id,
    companyId: matchedUser.company_id,
    exp: Date.now() + 8 * 60 * 60 * 1000 // 8 hours
  })).toString('base64')

  return NextResponse.json({
    token,
    userId: matchedUser.id,
    name: matchedUser.name,
    companyId: matchedUser.company_id,
    role: matchedUser.role
  })
}
'@
Set-Content -Path "app\api\installer\auth\route.ts" -Value $installerAuth -Encoding UTF8

# API: Installer jobs
$installerJobsApi = @'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

function getInstallerFromToken(request: Request) {
  const auth = request.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return null
  try {
    const payload = JSON.parse(Buffer.from(auth.slice(7), 'base64').toString())
    if (payload.exp < Date.now()) return null
    return payload
  } catch { return null }
}

export async function GET(request: Request) {
  const installer = getInstallerFromToken(request)
  if (!installer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = await createServiceClient()

  // Get jobs assigned to this installer
  const { data: assignments } = await service
    .from('job_assignments')
    .select('job_id')
    .eq('user_id', installer.userId)

  if (!assignments?.length) return NextResponse.json({ jobs: [] })

  const jobIds = assignments.map((a: any) => a.job_id)

  const { data: jobs } = await service
    .from('jobs')
    .select('*')
    .in('id', jobIds)
    .eq('status', 'active')

  // Check which jobs this installer is signed into today
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const { data: signins } = await service
    .from('signins')
    .select('job_id')
    .eq('user_id', installer.userId)
    .gte('signed_in_at', today.toISOString())
    .is('signed_out_at', null)

  const signedInJobIds = new Set(signins?.map((s: any) => s.job_id) || [])

  const jobsWithStatus = (jobs || []).map((j: any) => ({
    ...j,
    signed_in: signedInJobIds.has(j.id)
  }))

  return NextResponse.json({ jobs: jobsWithStatus })
}
'@
Set-Content -Path "app\api\installer\jobs\route.ts" -Value $installerJobsApi -Encoding UTF8

# API: Sign in
$signinApi = @'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

function getInstallerFromToken(request: Request) {
  const auth = request.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return null
  try {
    const payload = JSON.parse(Buffer.from(auth.slice(7), 'base64').toString())
    if (payload.exp < Date.now()) return null
    return payload
  } catch { return null }
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

export async function POST(request: Request) {
  const installer = getInstallerFromToken(request)
  if (!installer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { jobId, lat, lng, accuracy } = await request.json()
  const service = await createServiceClient()

  // Get job location
  const { data: job } = await service.from('jobs').select('lat, lng, company_id').eq('id', jobId).single()
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  let distanceMetres = 0
  let withinRange = true

  if (job.lat && job.lng) {
    distanceMetres = Math.round(haversine(lat, lng, job.lat, job.lng))
    withinRange = distanceMetres <= 500
  }

  // Save sign-in regardless (flag if out of range)
  const { error } = await service.from('signins').insert({
    job_id: jobId,
    user_id: installer.userId,
    company_id: job.company_id,
    lat, lng,
    accuracy_metres: accuracy,
    distance_from_site_metres: distanceMetres,
    within_range: withinRange,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ success: true, distanceMetres, withinRange })
}
'@
Set-Content -Path "app\api\signin\route.ts" -Value $signinApi -Encoding UTF8

# API: Diary + AI
$diaryApi = @'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'

function getInstallerFromToken(request: Request) {
  const auth = request.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return null
  try {
    const payload = JSON.parse(Buffer.from(auth.slice(7), 'base64').toString())
    if (payload.exp < Date.now()) return null
    return payload
  } catch { return null }
}

export async function POST(request: Request) {
  const installer = getInstallerFromToken(request)
  if (!installer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { jobId, text } = await request.json()
  if (!text?.trim()) return NextResponse.json({ error: 'No text' }, { status: 400 })

  const service = await createServiceClient()

  // Get job info
  const { data: job } = await service.from('jobs').select('name, company_id').eq('id', jobId).single()
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  // Save diary entry
  const { data: entry, error } = await service.from('diary_entries').insert({
    job_id: jobId,
    user_id: installer.userId,
    company_id: job.company_id,
    entry_text: text,
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Run AI analysis in background
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `You are analysing a construction site diary entry. Identify if there is a blocker (work completely stopped), issue (problem that needs attention), or nothing significant.

Diary entry: "${text}"

Respond with JSON only:
{"type": "blocker"|"issue"|"none", "message": "brief description for foreman or null"}`
      }]
    })

    const aiText = response.content[0].type === 'text' ? response.content[0].text : ''
    const aiResult = JSON.parse(aiText.replace(/```json|```/g, '').trim())

    if (aiResult.type !== 'none' && aiResult.message) {
      // Save alert
      await service.from('alerts').insert({
        company_id: job.company_id,
        job_id: jobId,
        diary_entry_id: entry.id,
        triggered_by: installer.userId,
        alert_type: aiResult.type,
        message: aiResult.message,
      })

      // Mark diary entry as processed
      await service.from('diary_entries').update({ ai_processed: true }).eq('id', entry.id)
    }
  } catch (e) {
    // AI failed silently — diary entry still saved
    console.error('AI processing failed:', e)
  }

  return NextResponse.json({ success: true })
}
'@
Set-Content -Path "app\api\diary\route.ts" -Value $diaryApi -Encoding UTF8

# Install Anthropic SDK
Write-Host "Installing Anthropic SDK..." -ForegroundColor Yellow
npm install @anthropic-ai/sdk

Write-Host "Done - Full platform built" -ForegroundColor Green
Write-Host "Files created:" -ForegroundColor Cyan
Write-Host "  app/admin/page.tsx (updated with onboarding redirect)" -ForegroundColor Cyan
Write-Host "  app/installer/page.tsx (PIN screen)" -ForegroundColor Cyan
Write-Host "  app/installer/jobs/page.tsx (jobs, diary, QA)" -ForegroundColor Cyan
Write-Host "  app/api/installer/auth/route.ts" -ForegroundColor Cyan
Write-Host "  app/api/installer/jobs/route.ts" -ForegroundColor Cyan
Write-Host "  app/api/signin/route.ts" -ForegroundColor Cyan
Write-Host "  app/api/diary/route.ts (with Claude AI)" -ForegroundColor Cyan
