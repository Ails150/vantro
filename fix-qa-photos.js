const fs = require("fs")
let c = fs.readFileSync("C:/vantro/app/installer/jobs/page.tsx", "utf8")

// Add photo state
c = c.replace(
  "  const [qaNote, setQaNote] = useState<Record<string, string>>({})",
  `  const [qaNote, setQaNote] = useState<Record<string, string>>({})
  const [qaPhotos, setQaPhotos] = useState<Record<string, File|null>>({})
  const [qaPhotoPreview, setQaPhotoPreview] = useState<Record<string, string>>({})
  const [qaUploading, setQaUploading] = useState<Record<string, boolean>>({})`
)

// Add photo upload function before signOut
c = c.replace(
  "  function signOut() {",
  `  async function uploadPhoto(itemId: string, file: File) {
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
      const uploadRes = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token },
        body: formData
      })
      if (uploadRes.ok) {
        const uploadData = await uploadRes.json()
        photoUrl = uploadData.url
        photoPath = uploadData.path
      }
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

  function signOut() {`
)

// Replace photo item UI - show camera input and preview
c = c.replace(
  `                      {(item.fail_note_required && state === 'pending') || item.item_type === 'photo' ? (
                        <div className="mt-2 flex gap-2">
                          <input value={qaNote[item.id] || ''} onChange={e => setQaNote(n => ({...n, [item.id]: e.target.value}))} placeholder={item.item_type === 'photo' ? 'Describe photo evidence' : 'Add note'} className="flex-1 bg-[#243040] border border-white/5 rounded-lg px-3 py-2 text-sm text-white placeholder-[#4d6478] focus:outline-none"/>
                          <button onClick={() => submitQAItem(item.id, 'submitted')} className="bg-[#00d4a0] text-[#0f1923] rounded-lg px-4 py-2 text-sm font-semibold">Submit</button>
                        </div>
                      ) : null}`,
  `                      {item.item_type === 'photo' && state === 'pending' && (
                        <div className="mt-2 space-y-2">
                          {qaPhotoPreview[item.id] && (
                            <img src={qaPhotoPreview[item.id]} alt="Preview" className="w-full h-40 object-cover rounded-lg"/>
                          )}
                          <label className="w-full flex items-center justify-center gap-2 bg-[#243040] border border-white/5 rounded-lg py-3 text-sm text-[#00d4a0] cursor-pointer">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="13" r="4" stroke="currentColor" stroke-width="1.5"/></svg>
                            {qaPhotos[item.id] ? 'Change photo' : 'Take photo / Upload'}
                            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => e.target.files?.[0] && uploadPhoto(item.id, e.target.files[0])}/>
                          </label>
                          <button
                            onClick={() => submitQAItemWithPhoto(item.id, 'submitted')}
                            disabled={!qaPhotos[item.id] || qaUploading[item.id]}
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
                      )}`
)

fs.writeFileSync("C:/vantro/app/installer/jobs/page.tsx", c, "utf8")
console.log("Done - " + (c.includes("submitQAItemWithPhoto") ? "SUCCESS" : "FAILED"))
