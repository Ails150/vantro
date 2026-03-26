const fs = require("fs")
let c = fs.readFileSync("components/admin/AdminDashboard.tsx", "utf8")

// Add editingJobId state after assigningJobId state
c = c.replace(
  "const [assigningJobId, setAssigningJobId] = useState(null)",
  "const [assigningJobId, setAssigningJobId] = useState(null)\n  const [editingJobId, setEditingJobId] = useState(null)\n  const [editJobName, setEditJobName] = useState(\"\")\n  const [editJobAddress, setEditJobAddress] = useState(\"\")\n  const [editJobTemplateId, setEditJobTemplateId] = useState(\"\")"
)

// Add updateJob function after addJob function
c = c.replace(
  "  async function addMember()",
  `  async function updateJob(jobId: string) {
    if (!editJobName.trim() || !editJobAddress.trim()) { setFormError("Enter job name and address"); return }
    setSaving(true); setFormError("")
    const { error } = await supabase.from("jobs").update({ name: editJobName.trim(), address: editJobAddress.trim(), checklist_template_id: editJobTemplateId || null }).eq("id", jobId)
    if (error) { setFormError(error.message); setSaving(false); return }
    setEditingJobId(null); setSaving(false)
    router.refresh()
  }

  async function addMember()`
)

// Add Edit button next to Assign button in jobs list
c = c.replace(
  `<button onClick={() => setAssigningJobId(isAssigning ? null : j.id)} className="text-sm border border-gray-200 text-gray-600 hover:border-teal-300 hover:text-teal-600 rounded-xl px-4 py-2 transition-colors flex-shrink-0">
                        {isAssigning ? "Done" : "Assign"}
                      </button>`,
  `<button onClick={() => { setEditingJobId(editingJobId === j.id ? null : j.id); setEditJobName(j.name); setEditJobAddress(j.address); setEditJobTemplateId(j.checklist_template_id || ""); setFormError("") }} className="text-sm border border-gray-200 text-gray-600 hover:border-teal-300 hover:text-teal-600 rounded-xl px-4 py-2 transition-colors flex-shrink-0">
                        {editingJobId === j.id ? "Cancel" : "Edit"}
                      </button>
                      <button onClick={() => setAssigningJobId(isAssigning ? null : j.id)} className="text-sm border border-gray-200 text-gray-600 hover:border-teal-300 hover:text-teal-600 rounded-xl px-4 py-2 transition-colors flex-shrink-0">
                        {isAssigning ? "Done" : "Assign"}
                      </button>`
)

// Add edit form panel after the main job row div
c = c.replace(
  `                    {isAssigning && (`,
  `                    {editingJobId === j.id && (
                      <div className="px-6 pb-5">
                        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
                          <h4 className="text-sm font-semibold">Edit job</h4>
                          <input value={editJobName} onChange={e => setEditJobName(e.target.value)} placeholder="Job name" className={inp}/>
                          <input value={editJobAddress} onChange={e => setEditJobAddress(e.target.value)} placeholder="Site address" className={inp}/>
                          <div>
                            <label className="block text-sm font-medium text-gray-600 mb-1">Checklist template</label>
                            <select value={editJobTemplateId} onChange={e => setEditJobTemplateId(e.target.value)} className={inp}>
                              <option value="">No checklist</option>
                              {checklistTemplates.map((t: any) => <option key={t.id} value={t.id}>{t.name} ({t.checklist_items?.length || 0} items)</option>)}
                            </select>
                          </div>
                          {formError && <p className="text-sm text-red-500">{formError}</p>}
                          <div className="flex gap-3">
                            <button onClick={() => updateJob(j.id)} disabled={saving} className={btn}>{saving ? "Saving..." : "Save changes"}</button>
                            <button onClick={() => setEditingJobId(null)} className={btnGhost}>Cancel</button>
                          </div>
                        </div>
                      </div>
                    )}
                    {isAssigning && (`
)

fs.writeFileSync("components/admin/AdminDashboard.tsx", c, "utf8")
console.log("Done")
