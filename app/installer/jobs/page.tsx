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
  const [qaItems, setQaItems] = useState<any[]>([])
  const [qaSubmissions, setQaSubmissions] = useState<any[]>([])
  const [qaLoading, setQaLoading] = useState(false)
  const [qaNote, setQaNote] = useState<Record<string, string>>({})

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
          setGpsMessage(`GPS confirmed Â· ${data.distanceMetres}m from site Â· Â±${Math.round(accuracy)}m accuracy`)
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

  async function loadQA(job: any) {
    setQaLoading(true)
    const token = localStorage.getItem('vantro_installer_token')
    const res = await fetch('/api/qa?jobId=' + job.id, { headers: { 'Authorization': 'Bearer ' + token } })
    const data = await res.json()
    setQaItems(data.items || [])
    setQaSubmissions(data.submissions || [])
    setQaLoading(false)
  }

  async function submitQAItem(itemId: string, state: string) {
    const token = localStorage.getItem('vantro_installer_token')
    const notes = qaNote[itemId] || ''
    await fetch('/api/qa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ jobId: activeJob.id, itemId, state, notes })
    })
    setQaSubmissions(prev => {
      const existing = prev.find(s => s.checklist_item_id === itemId)
      if (existing) return prev.map(s => s.checklist_item_id === itemId ? { ...s, state, notes } : s)
      return [...prev, { checklist_item_id: itemId, state, notes }]
    })
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
                  {diarySuccess ? 'Submitted âœ“' : diaryLoading ? 'Submitting...' : 'Submit entry'}
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
            {qaLoading ? (
              <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-[#00d4a0] border-t-transparent rounded-full animate-spin"/></div>
            ) : qaItems.length === 0 ? (
              <div className="bg-[#1a2635] border border-white/5 rounded-xl p-6 text-center">
                <div className="text-[#4d6478] text-sm">No checklist set for this job.</div>
                <div className="text-[#4d6478] text-xs mt-1">Ask your manager to add one.</div>
              </div>
            ) : (
              <div className="space-y-3">
                {qaItems.map((item: any) => {
                  const sub = qaSubmissions.find((s: any) => s.checklist_item_id === item.id)
                  const state = sub?.state || 'pending'
                  return (
                    <div key={item.id} className="bg-[#1a2635] border border-white/5 rounded-xl p-4">
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex-1">
                          <div className="text-sm font-medium">{item.label}</div>
                          <div className="flex gap-2 mt-1 flex-wrap">
                            {item.is_mandatory && <span className="text-xs text-red-400">Mandatory</span>}
                            {item.requires_photo && <span className="text-xs text-blue-400">Photo required</span>}
                            {item.item_type !== 'tick' && <span className="text-xs text-[#4d6478] capitalize">{item.item_type.replace('_', ' ')}</span>}
                          </div>
                        </div>
                        <span className={"text-xs px-2 py-1 rounded-full font-medium flex-shrink-0 " + (state === 'pass' || state === 'submitted' ? 'bg-[#00d4a0]/10 text-[#00d4a0]' : state === 'fail' ? 'bg-red-400/10 text-red-400' : 'bg-white/5 text-[#4d6478]')}>
                          {state === 'submitted' ? 'Done' : state === 'pass' ? 'Pass' : state === 'fail' ? 'Fail' : 'Pending'}
                        </span>
                      </div>
                      {item.item_type === 'tick' && state === 'pending' && (
                        <button onClick={() => submitQAItem(item.id, 'submitted')} className="w-full bg-[#00d4a0]/10 text-[#00d4a0] border border-[#00d4a0]/20 rounded-lg py-2 text-sm font-medium">Mark complete</button>
                      )}
                      {item.item_type === 'pass_fail' && state === 'pending' && (
                        <div className="flex gap-2">
                          <button onClick={() => submitQAItem(item.id, 'pass')} className="flex-1 bg-[#00d4a0]/10 text-[#00d4a0] border border-[#00d4a0]/20 rounded-lg py-2 text-sm font-medium">Pass</button>
                          <button onClick={() => submitQAItem(item.id, 'fail')} className="flex-1 bg-red-400/10 text-red-400 border border-red-400/20 rounded-lg py-2 text-sm font-medium">Fail</button>
                        </div>
                      )}
                      {item.item_type === 'measurement' && state === 'pending' && (
                        <div className="flex gap-2">
                          <input value={qaNote[item.id] || ''} onChange={e => setQaNote(n => ({...n, [item.id]: e.target.value}))} placeholder="Enter measurement" className="flex-1 bg-[#243040] border border-white/5 rounded-lg px-3 py-2 text-sm text-white placeholder-[#4d6478] focus:outline-none"/>
                          <button onClick={() => submitQAItem(item.id, 'submitted')} className="bg-[#00d4a0] text-[#0f1923] rounded-lg px-4 py-2 text-sm font-semibold">Submit</button>
                        </div>
                      )}
                      {(item.fail_note_required && state === 'pending') || item.item_type === 'photo' ? (
                        <div className="mt-2 flex gap-2">
                          <input value={qaNote[item.id] || ''} onChange={e => setQaNote(n => ({...n, [item.id]: e.target.value}))} placeholder={item.item_type === 'photo' ? 'Describe photo evidence' : 'Add note'} className="flex-1 bg-[#243040] border border-white/5 rounded-lg px-3 py-2 text-sm text-white placeholder-[#4d6478] focus:outline-none"/>
                          <button onClick={() => submitQAItem(item.id, 'submitted')} className="bg-[#00d4a0] text-[#0f1923] rounded-lg px-4 py-2 text-sm font-semibold">Submit</button>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
