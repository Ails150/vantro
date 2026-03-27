'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function InstallerJobsPage() {
  const router = useRouter()
  const [jobs, setJobs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [installerName, setInstallerName] = useState('')
  const [activeJob, setActiveJob] = useState<any>(null)
  const [view, setView] = useState<'jobs'|'diary'|'qa'|'defects'>('jobs')
  const [diaryText, setDiaryText] = useState('')
  const [diaryLoading, setDiaryLoading] = useState(false)
  const [diarySuccess, setDiarySuccess] = useState(false)
  const [gpsStatus, setGpsStatus] = useState<'idle'|'checking'|'confirmed'|'blocked'>('idle')
  const [gpsMessage, setGpsMessage] = useState('')
  const [qaItems, setQaItems] = useState<any[]>([])
  const [qaSubmissions, setQaSubmissions] = useState<any[]>([])
  const [qaLoading, setQaLoading] = useState(false)
  const [qaNote, setQaNote] = useState<Record<string, string>>({})
  const [defects, setDefects] = useState<any[]>([])
  const [defectText, setDefectText] = useState("")
  const [defectSeverity, setDefectSeverity] = useState("minor")
  const [defectPhoto, setDefectPhoto] = useState<File|null>(null)
  const [defectPreview, setDefectPreview] = useState("")
  const [defectLoading, setDefectLoading] = useState(false)
  const [defectSuccess, setDefectSuccess] = useState(false)
  const [qaPhotos, setQaPhotos] = useState<Record<string, File|null>>({})
  const [qaPhotoPreview, setQaPhotoPreview] = useState<Record<string, string>>({})
  const [qaUploading, setQaUploading] = useState<Record<string, boolean>>({})
  const [signInTime, setSignInTime] = useState<Date|null>(null)
  const [lastActivity, setLastActivity] = useState<Date>(new Date())
  const [elapsed, setElapsed] = useState("")

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
    const jobs = data.jobs || []
    setJobs(jobs)
    const alreadySignedIn = jobs.find((j: any) => j.signed_in)
    if (alreadySignedIn) { setActiveJob(alreadySignedIn); setGpsStatus('confirmed'); setSignInTime(new Date()) }
    setLoading(false)
  }

  useEffect(() => {
    if (!signInTime) return
    const interval = setInterval(() => {
      const diff = Math.floor((Date.now() - signInTime.getTime()) / 1000)
      const h = Math.floor(diff / 3600)
      const m = Math.floor((diff % 3600) / 60)
      const s = diff % 60
      setElapsed((h > 0 ? h + "h " : "") + (m > 0 ? m + "m " : "") + s + "s")
    }, 1000)
    return () => clearInterval(interval)
  }, [signInTime])

  useEffect(() => {
    const token = localStorage.getItem('vantro_installer_token')
    if (!token) return
    const interval = setInterval(() => loadJobs(token), 30000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!activeJob) return
    const events = ['click', 'touchstart', 'keydown', 'scroll']
    const resetActivity = () => setLastActivity(new Date())
    events.forEach(e => window.addEventListener(e, resetActivity))
    const check = setInterval(() => {
      const inactive = (Date.now() - lastActivity.getTime()) / 1000 / 60
      if (inactive >= 30) {
        const token = localStorage.getItem('vantro_installer_token')
        if (token && activeJob) {
          fetch('/api/signout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ jobId: activeJob.id, auto: true })
          })
        }
        setJobs(prev => prev.map((j: any) => ({ ...j, signed_in: false })))
        setActiveJob(null)
        setGpsStatus('idle')
        setSignInTime(null)
        setElapsed("")
        setView('jobs')
        alert('You have been automatically signed out due to 30 minutes of inactivity.')
      }
    }, 60000)
    return () => {
      events.forEach(e => window.removeEventListener(e, resetActivity))
      clearInterval(check)
    }
  }, [activeJob, lastActivity])

  function calcDistance(lat1: number, lng1: number, lat2: number, lng2: number) {
    const R = 6371000
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLng = (lng2 - lng1) * Math.PI / 180
    const a = Math.sin(dLat/2)*Math.sin(dLat/2)+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)*Math.sin(dLng/2)
    return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)))
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
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ jobId: job.id, lat: latitude, lng: longitude, accuracy: Math.round(accuracy) })
        })
        const data = await res.json()
        if (!res.ok) {
          setGpsStatus('blocked')
          setGpsMessage(data.error || 'Cannot sign in')
          return
        }
        setSignInTime(new Date())
        setGpsStatus('confirmed')
        setGpsMessage(`GPS confirmed · ${data.distanceMetres}m from site · ±${Math.round(accuracy)}m accuracy`)
        setJobs(prev => prev.map(j => j.id === job.id ? { ...j, signed_in: true } : j))
      },
      (err) => {
        setGpsStatus('blocked')
        setGpsMessage(err.code === 1 ? 'Location permission denied. Please allow location access.' : 'Could not get your location. Try again.')
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    )
  }

  async function signOutFromJob(job: any) {
    const token = localStorage.getItem('vantro_installer_token')
    if (!navigator.geolocation) {
      alert('Location not available on this device')
      return
    }
    navigator.geolocation.getCurrentPosition(async (pos) => {
      if (job.lat && job.lng) {
        const dist = calcDistance(pos.coords.latitude, pos.coords.longitude, job.lat, job.lng)
        if (dist > 150) {
          alert('You are ' + dist + 'm from the job site. You must be within 150m to sign out.')
          return
        }
      }
      await fetch('/api/signout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ jobId: job.id })
      })
      setJobs(prev => prev.map((j: any) => j.id === job.id ? { ...j, signed_in: false } : j))
      setActiveJob(null)
      setGpsStatus('idle')
      setView('jobs')
    }, () => {
      alert('Could not get your location. Please enable location access to sign out.')
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 })
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

  async function loadDefects(job: any) {
    const token = localStorage.getItem('vantro_installer_token')
    const res = await fetch('/api/defects?jobId=' + job.id, { headers: { 'Authorization': 'Bearer ' + token } })
    const data = await res.json()
    setDefects(data.defects || [])
  }

  async function submitDefect() {
    if (!defectText.trim() || !activeJob) return
    setDefectLoading(true)
    const token = localStorage.getItem('vantro_installer_token')
    let photoUrl = '', photoPath = ''
    if (defectPhoto) {
      const formData = new FormData()
      formData.append('file', defectPhoto)
      formData.append('jobId', activeJob.id)
      formData.append('itemId', 'defect')
      const uploadRes = await fetch('/api/upload', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token }, body: formData })
      if (uploadRes.ok) { const d = await uploadRes.json(); photoUrl = d.url; photoPath = d.path }
    }
    await fetch('/api/defects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ action: 'create', jobId: activeJob.id, description: defectText, severity: defectSeverity, photoUrl, photoPath })
    })
    setDefectText("")
    setDefectSeverity("minor")
    setDefectPhoto(null)
    setDefectPreview("")
    setDefectSuccess(true)
    setTimeout(() => setDefectSuccess(false), 2000)
    loadDefects(activeJob)
    setDefectLoading(false)
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

  async function uploadPhoto(itemId: string, file: File) {
    setQaUploading(prev => ({...prev, [itemId]: true}))
    const preview = URL.createObjectURL(file)
    setQaPhotoPreview(prev => ({...prev, [itemId]: preview}))
    setQaPhotos(prev => ({...prev, [itemId]: file}))
    setQaUploading(prev => ({...prev, [itemId]: false}))
  }

  async function submitQAItemWithPhoto(itemId: string, state: string) {
    const token = localStorage.getItem('vantro_installer_token')
    const notes = qaNote[itemId] || ''
    const photo = qaPhotos[itemId]
    let photoUrl = ''
    let photoPath = ''
    if (photo && activeJob) {
      setQaUploading(prev => ({...prev, [itemId]: true}))
      const formData = new FormData()
      formData.append('file', photo)
      formData.append('jobId', activeJob.id)
      formData.append('itemId', itemId)
      const uploadRes = await fetch('/api/upload', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token }, body: formData })
      if (uploadRes.ok) { const uploadData = await uploadRes.json(); photoUrl = uploadData.url; photoPath = uploadData.path }
      setQaUploading(prev => ({...prev, [itemId]: false}))
    }
    await fetch('/api/qa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ jobId: activeJob.id, itemId, state, notes, photoUrl, photoPath })
    })
    setQaSubmissions(prev => {
      const existing = prev.find((s: any) => s.checklist_item_id === itemId)
      if (existing) return prev.map((s: any) => s.checklist_item_id === itemId ? { ...s, state, notes, photo_url: photoUrl } : s)
      return [...prev, { checklist_item_id: itemId, state, notes, photo_url: photoUrl }]
    })
  }

  async function submitQAForApproval() {
    const token = localStorage.getItem('vantro_installer_token')
    const res = await fetch('/api/qa/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ jobId: activeJob.id })
    })
    if (res.ok) { alert('QA submitted for foreman approval!'); loadQA(activeJob) }
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

      {gpsStatus !== 'idle' && activeJob && (
        <div className={`mx-4 mt-4 rounded-xl px-4 py-3 text-sm flex items-center gap-2 ${
          gpsStatus === 'checking' ? 'bg-[#1a2635] text-[#8fa3b8]' :
          gpsStatus === 'confirmed' ? 'bg-[#00d4a0]/08 border border-[#00d4a0]/20 text-[#00d4a0]' :
          'bg-red-400/08 border border-red-400/20 text-red-300'
        }`}>
          {gpsStatus === 'checking' && <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin flex-shrink-0"/>}
          {gpsStatus === 'confirmed' && <div className="w-2 h-2 rounded-full bg-[#00d4a0] flex-shrink-0"/>}
          {gpsStatus === 'blocked' && <div className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0"/>}
          <span>{gpsStatus === 'checking' ? 'Checking your location...' : gpsMessage}{gpsStatus === 'confirmed' && elapsed ? ' · ' + elapsed : ''}</span>
        </div>
      )}

      {activeJob && (gpsStatus === 'confirmed' || activeJob.signed_in) && (
        <div className="flex gap-0 border-b border-white/5 px-4 mt-4">
          {['jobs','diary','qa'].map(t => (
            <button key={t} onClick={() => setView(t as any)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors capitalize ${view === t ? 'border-[#00d4a0] text-[#00d4a0]' : 'border-transparent text-[#4d6478]'}`}>
              {t === 'qa' ? 'QA' : t}
            </button>
          ))}
        </div>
      )}

      <div className="px-4 py-4">

        {view === 'jobs' && (
          <div className="space-y-3">
            <h2 className="text-sm font-medium text-[#8fa3b8] mb-3">Your jobs today</h2>
            {jobs.length === 0 && <div className="text-center text-[#4d6478] text-sm py-12">No jobs assigned today</div>}
            {jobs.map((job: any) => (
              <div key={job.id} className={`bg-[#1a2635] border rounded-xl p-4 ${activeJob?.id === job.id ? 'border-[#00d4a0]/30' : 'border-white/5'}`}>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <div className="font-medium text-sm">{job.name}</div>
                    <div className="text-xs text-[#4d6478] mt-0.5">{job.address}</div>
                  </div>
                  {job.signed_in && <span className="text-xs bg-[#00d4a0]/10 text-[#00d4a0] border border-[#00d4a0]/20 rounded-full px-2 py-0.5 flex-shrink-0">On site</span>}
                </div>
                {!job.signed_in ? (
                  <button onClick={() => signInToJob(job)} disabled={gpsStatus === 'checking'}
                    className="w-full bg-[#00d4a0] hover:bg-[#00a87e] disabled:opacity-40 text-[#0f1923] font-semibold rounded-lg py-2.5 text-sm transition-colors">
                    {gpsStatus === 'checking' && activeJob?.id === job.id ? 'Getting location...' : 'Sign in to this job'}
                  </button>
                ) : (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <button onClick={() => { setActiveJob(job); setView('diary') }} className="flex-1 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-lg py-2 text-xs font-medium">Site diary</button>
                      <button onClick={() => { setActiveJob(job); setView('defects'); loadDefects(job) }} className="flex-1 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg py-2 text-xs font-medium">Defects</button>
                      <button onClick={() => { setActiveJob(job); setView('qa'); loadQA(job) }} className="flex-1 bg-[#00d4a0]/10 text-[#00d4a0] border border-[#00d4a0]/20 rounded-lg py-2 text-xs font-medium">QA checklist</button>
                    </div>
                    <button onClick={() => signOutFromJob(job)} className="w-full bg-red-400/10 text-red-400 border border-red-400/20 rounded-lg py-2 text-xs font-medium">Sign out of job</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {view === 'diary' && activeJob && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <button onClick={() => setView('jobs')} className="text-[#4d6478]">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M19 12H5M12 19l-7-7 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
              <div><div className="font-medium text-sm">Site diary</div><div className="text-xs text-[#4d6478]">{activeJob.name}</div></div>
            </div>
            <div className="bg-[#1a2635] border border-white/5 rounded-xl p-4">
              <textarea value={diaryText} onChange={e => setDiaryText(e.target.value)}
                placeholder="What happened on site today? Log progress, issues, blockers, or anything the office needs to know..."
                rows={6} className="w-full bg-transparent text-white placeholder-[#4d6478] text-sm resize-none outline-none leading-relaxed"/>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/5">
                <span className="text-xs text-[#4d6478]">{diaryText.length} characters</span>
                <button onClick={submitDiary} disabled={!diaryText.trim() || diaryLoading}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${diarySuccess ? 'bg-[#00d4a0]/10 text-[#00d4a0] border border-[#00d4a0]/20' : 'bg-[#00d4a0] text-[#0f1923] hover:bg-[#00a87e] disabled:opacity-40'}`}>
                  {diarySuccess ? 'Submitted ✓' : diaryLoading ? 'Submitting...' : 'Submit entry'}
                </button>
              </div>
            </div>
            <p className="text-xs text-[#4d6478] mt-3 text-center">AI reads your entry instantly and alerts the foreman to any issues.</p>
          </div>
        )}

        {view === 'defects' && activeJob && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <button onClick={() => setView('jobs')} className="text-[#4d6478] hover:text-white transition-colors">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M19 12H5M12 19l-7-7 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
              <div><div className="font-semibold">Defects</div><div className="text-xs text-[#4d6478]">{activeJob.name}</div></div>
            </div>
            <div className="bg-[#1a2535] rounded-2xl p-4 space-y-3">
              <div className="text-sm font-semibold">Log a defect</div>
              <textarea value={defectText} onChange={e => setDefectText(e.target.value)} placeholder="Describe the defect..." rows={3} className="w-full bg-[#243040] border border-white/5 rounded-xl px-3 py-2 text-sm text-white placeholder-[#4d6478] focus:outline-none resize-none"/>
              <select value={defectSeverity} onChange={e => setDefectSeverity(e.target.value)} className="w-full bg-[#243040] border border-white/5 rounded-xl px-3 py-2 text-sm text-white focus:outline-none">
                <option value="minor">Minor</option>
                <option value="major">Major</option>
                <option value="critical">Critical</option>
              </select>
              {defectPreview && <img src={defectPreview} alt="Preview" className="w-full h-32 object-cover rounded-xl"/>}
              <label className="w-full flex items-center justify-center gap-2 bg-[#243040] border border-white/5 rounded-xl py-2.5 text-sm text-[#00d4a0] cursor-pointer">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" stroke="currentColor" strokeWidth="1.5"/><circle cx="12" cy="13" r="4" stroke="currentColor" strokeWidth="1.5"/></svg>
                {defectPhoto ? 'Change photo' : 'Add photo'}
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { if (e.target.files?.[0]) { setDefectPhoto(e.target.files[0]); setDefectPreview(URL.createObjectURL(e.target.files[0])) }}}/>
              </label>
              <button onClick={submitDefect} disabled={defectLoading || !defectText.trim()} className="w-full bg-[#00d4a0] disabled:opacity-40 text-[#0f1923] font-bold rounded-xl py-3 text-sm">
                {defectLoading ? 'Submitting...' : defectSuccess ? 'Logged!' : 'Log defect'}
              </button>
            </div>
            {defects.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-semibold text-[#8fa3b8]">Previous defects</div>
                {defects.map((d: any) => (
                  <div key={d.id} className="bg-[#1a2535] rounded-xl p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <span className={"text-xs px-2 py-1 rounded-full font-medium " + (d.severity === 'critical' ? 'bg-red-500/20 text-red-400' : d.severity === 'major' ? 'bg-amber-500/20 text-amber-400' : 'bg-gray-500/20 text-gray-400')}>{d.severity}</span>
                      <span className={"text-xs px-2 py-1 rounded-full font-medium " + (d.status === 'resolved' ? 'bg-teal-500/20 text-teal-400' : 'bg-red-500/20 text-red-400')}>{d.status}</span>
                    </div>
                    <p className="text-sm text-white">{d.description}</p>
                    {d.photo_url && <img src={d.photo_url} alt="Defect" className="w-full h-32 object-cover rounded-lg mt-2"/>}
                    {d.resolution_note && <p className="text-xs text-[#4d6478] mt-2">Resolution: {d.resolution_note}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {view === 'qa' && activeJob && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <button onClick={() => setView('jobs')} className="text-[#4d6478]">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M19 12H5M12 19l-7-7 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
              <div><div className="font-medium text-sm">QA checklist</div><div className="text-xs text-[#4d6478]">{activeJob.name}</div></div>
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
                      {item.item_type === 'photo' && state === 'pending' && (
                        <div className="mt-2 space-y-2">
                          {qaPhotoPreview[item.id] && <img src={qaPhotoPreview[item.id]} alt="Preview" className="w-full h-40 object-cover rounded-lg"/>}
                          <label className="w-full flex items-center justify-center gap-2 bg-[#243040] border border-white/5 rounded-lg py-3 text-sm text-[#00d4a0] cursor-pointer">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" stroke="currentColor" strokeWidth="1.5"/><circle cx="12" cy="13" r="4" stroke="currentColor" strokeWidth="1.5"/></svg>
                            {qaPhotos[item.id] ? 'Change photo' : 'Take photo / Upload'}
                            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => e.target.files?.[0] && uploadPhoto(item.id, e.target.files[0])}/>
                          </label>
                          <button onClick={() => submitQAItemWithPhoto(item.id, 'submitted')} disabled={!qaPhotos[item.id] || qaUploading[item.id]}
                            className="w-full bg-[#00d4a0] disabled:opacity-40 text-[#0f1923] rounded-lg py-2 text-sm font-semibold">
                            {qaUploading[item.id] ? 'Uploading...' : 'Submit with photo'}
                          </button>
                        </div>
                      )}
                      {item.fail_note_required && state === 'fail' && (
                        <div className="mt-2 flex gap-2">
                          <input value={qaNote[item.id] || ''} onChange={e => setQaNote(n => ({...n, [item.id]: e.target.value}))} placeholder="Note required on fail" className="flex-1 bg-[#243040] border border-white/5 rounded-lg px-3 py-2 text-sm text-white placeholder-[#4d6478] focus:outline-none"/>
                          <button onClick={() => submitQAItemWithPhoto(item.id, 'fail')} className="bg-red-500 text-white rounded-lg px-4 py-2 text-sm font-semibold">Submit</button>
                        </div>
                      )}
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
