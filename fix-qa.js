const fs = require("fs")
let c = fs.readFileSync("app/installer/jobs/page.tsx", "utf8")

// Add qaItems and qaSubmissions state
c = c.replace(
  "const [gpsMessage, setGpsMessage] = useState('')",
  `const [gpsMessage, setGpsMessage] = useState('')
  const [qaItems, setQaItems] = useState<any[]>([])
  const [qaSubmissions, setQaSubmissions] = useState<any[]>([])
  const [qaLoading, setQaLoading] = useState(false)
  const [qaNote, setQaNote] = useState<Record<string, string>>({})`
)

// Add loadQA function after submitDiary
c = c.replace(
  "  function signOut() {",
  `  async function loadQA(job: any) {
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

  function signOut() {`
)

// Update QA tab click to load QA items
c = c.replace(
  "onClick={() => setView('qa')} className={`px-4 py-2.5 text-sm",
  "onClick={() => { setView('qa'); if (activeJob) loadQA(activeJob) }} className={`px-4 py-2.5 text-sm"
)

// Replace QA placeholder with real checklist
c = c.replace(
  `            <div className="bg-[#1a2635] border border-white/5 rounded-xl p-4 text-center py-12">
              <div className="text-[#4d6478] text-sm">QA checklist loads here based on the job template.</div>
              <div className="text-[#4d6478] text-xs mt-2">Set up in your admin dashboard.</div>
            </div>`,
  `            {qaLoading ? (
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
            )}`
)

fs.writeFileSync("app/installer/jobs/page.tsx", c, "utf8")
console.log("Done")
