const fs = require("fs")
let c = fs.readFileSync("C:/vantro/app/installer/jobs/page.tsx", "utf8")

// Add defect state
c = c.replace(
  "  const [qaNote, setQaNote] = useState<Record<string, string>>({})",
  `  const [qaNote, setQaNote] = useState<Record<string, string>>({})
  const [defects, setDefects] = useState<any[]>([])
  const [defectText, setDefectText] = useState("")
  const [defectSeverity, setDefectSeverity] = useState("minor")
  const [defectPhoto, setDefectPhoto] = useState<File|null>(null)
  const [defectPreview, setDefectPreview] = useState("")
  const [defectLoading, setDefectLoading] = useState(false)
  const [defectSuccess, setDefectSuccess] = useState(false)`
)

// Add loadDefects and submitDefect functions
c = c.replace(
  "  async function loadQA(job: any) {",
  `  async function loadDefects(job: any) {
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

  async function loadQA(job: any) {`
)

// Add Defects tab button
c = c.replace(
  `<button onClick={() => { setActiveJob(job); setView('diary') }} className="flex-1 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-lg py-2 text-xs font-medium">Site diary</button>`,
  `<button onClick={() => { setActiveJob(job); setView('diary') }} className="flex-1 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-lg py-2 text-xs font-medium">Site diary</button>
                      <button onClick={() => { setActiveJob(job); setView('defects'); loadDefects(job) }} className="flex-1 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg py-2 text-xs font-medium">Defects</button>`
)

// Add defects view
c = c.replace(
  "        {view === 'qa' && activeJob && (",
  `        {view === 'defects' && activeJob && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <button onClick={() => setView('jobs')} className="text-[#4d6478] hover:text-white transition-colors">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M19 12H5M12 19l-7-7 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
              <div>
                <div className="font-semibold">Defects</div>
                <div className="text-xs text-[#4d6478]">{activeJob.name}</div>
              </div>
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

        {view === 'qa' && activeJob && (`
)

fs.writeFileSync("C:/vantro/app/installer/jobs/page.tsx", c, "utf8")
console.log("Done - " + (c.includes("submitDefect") ? "SUCCESS" : "FAILED"))
