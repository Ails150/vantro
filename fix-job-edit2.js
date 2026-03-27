const fs = require("fs")
let c = fs.readFileSync("components/admin/AdminDashboard.tsx", "utf8")

// Add status to edit form
c = c.replace(
  '                          <label className="block text-sm font-medium text-gray-600 mb-1">Checklist template</label>\n                            <select value={editJobTemplateId} onChange={e => setEditJobTemplateId(e.target.value)} className={inp}>',
  `                          <label className="block text-sm font-medium text-gray-600 mb-1">Status</label>
                            <select value={editJobStatus || j.status} onChange={e => setEditJobStatus(e.target.value)} className={inp}>
                              <option value="active">Active</option>
                              <option value="on_hold">On hold</option>
                              <option value="completed">Completed</option>
                              <option value="cancelled">Cancelled</option>
                            </select>
                          </div>
                          <div>
                          <label className="block text-sm font-medium text-gray-600 mb-1">Checklist template</label>
                            <select value={editJobTemplateId} onChange={e => setEditJobTemplateId(e.target.value)} className={inp}>`
)

// Add editJobStatus state
c = c.replace(
  'const [editJobLat, setEditJobLat] = useState(null)',
  'const [editJobLat, setEditJobLat] = useState(null)\n  const [editJobStatus, setEditJobStatus] = useState("")'
)

// Add status to updateJob
c = c.replace(
  'address: editJobAddress.trim(), checklist_template_id: editJobTemplateId || null, lat: editJobLat, lng: editJobLng })',
  'address: editJobAddress.trim(), checklist_template_id: editJobTemplateId || null, lat: editJobLat, lng: editJobLng, status: editJobStatus || j.status })'
)

// Add Delete button inside edit form
c = c.replace(
  '<button onClick={() => updateJob(j.id)} disabled={saving} className={btn}>{saving ? "Saving..." : "Save changes"}</button>\n                          <button onClick={() => setEditingJobId(null)} className={btnGhost}>Cancel</button>',
  `<button onClick={() => updateJob(j.id)} disabled={saving} className={btn}>{saving ? "Saving..." : "Save changes"}</button>
                          <button onClick={() => setEditingJobId(null)} className={btnGhost}>Cancel</button>
                          <button onClick={() => deleteJob(j.id, j.name)} className="bg-red-50 hover:bg-red-100 text-red-500 border border-red-200 rounded-xl px-5 py-2.5 text-sm transition-colors">Delete job</button>`
)

fs.writeFileSync("components/admin/AdminDashboard.tsx", c, "utf8")
console.log("Done - " + (c.includes("editJobStatus") ? "SUCCESS" : "FAILED"))
