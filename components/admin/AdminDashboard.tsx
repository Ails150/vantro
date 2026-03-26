"use client"
import PayrollTab from "@/components/admin/PayrollTab"
import AnalyticsTab from "@/components/admin/AnalyticsTab"
import { useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"

interface Props {
  user: any; userData: any; jobs: any[]; signins: any[]; alerts: any[]
  pendingQA: any[]; teamMembers: any[]; jobAssignments: any[]
  checklistTemplates: any[]; diaryEntries: any[]; defaultTab: string
}

export default function AdminDashboard({ user, userData, jobs, signins, alerts, pendingQA, teamMembers, jobAssignments, checklistTemplates, diaryEntries, defaultTab }: Props) {
  const [activeTab, setActiveTab] = useState(() => {
    try { return localStorage.getItem("vantro_tab") || defaultTab } catch { return defaultTab }
  })
  const [showAddJob, setShowAddJob] = useState(false)
  const [showAddMember, setShowAddMember] = useState(false)
  const [showAddTemplate, setShowAddTemplate] = useState(false)
  const [showAddItem, setShowAddItem] = useState(null)
  const [assigningJobId, setAssigningJobId] = useState(null)
  const [editingJobId, setEditingJobId] = useState(null)
  const [editJobName, setEditJobName] = useState("")
  const [editJobAddress, setEditJobAddress] = useState("")
  const [editJobTemplateId, setEditJobTemplateId] = useState("")
  const [jobName, setJobName] = useState("")
  const [jobAddress, setJobAddress] = useState("")
  const [jobTemplateId, setJobTemplateId] = useState("")
  const [memberName, setMemberName] = useState("")
  const [memberEmail, setMemberEmail] = useState("")
  const [templateName, setTemplateName] = useState("")
  const [itemLabel, setItemLabel] = useState("")
  const [itemType, setItemType] = useState("tick")
  const [itemMandatory, setItemMandatory] = useState(false)
  const [itemPhoto, setItemPhoto] = useState(false)
  const [itemVideo, setItemVideo] = useState(false)
  const [itemFailNote, setItemFailNote] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState("")
  const router = useRouter()
  const supabase = createClient()

  function switchTab(tab: string) {
    setActiveTab(tab)
    try { localStorage.setItem("vantro_tab", tab) } catch {}
  }

  async function handleSignOut() { await supabase.auth.signOut(); router.push("/login") }
  async function approveQA(id: string) { await supabase.from("qa_submissions").update({ state: "approved", reviewed_at: new Date().toISOString() }).eq("id", id); router.refresh() }
  async function rejectQA(id: string, note: string) { await supabase.from("qa_submissions").update({ state: "rejected", rejection_note: note, reviewed_at: new Date().toISOString() }).eq("id", id); router.refresh() }
  async function markAlertRead(id: string) { await supabase.from("alerts").update({ is_read: true }).eq("id", id); router.refresh() }

  async function addJob() {
    if (!jobName.trim() || !jobAddress.trim()) { setFormError("Enter job name and address"); return }
    setSaving(true); setFormError("")
    const { error } = await supabase.from("jobs").insert({ company_id: userData.company_id, name: jobName.trim(), address: jobAddress.trim(), status: "active", checklist_template_id: jobTemplateId || null })
    if (error) { setFormError(error.message); setSaving(false); return }
    setJobName(""); setJobAddress(""); setJobTemplateId(""); setShowAddJob(false); setSaving(false)
    router.refresh()
  }

  async function updateJob(jobId: string) {
    if (!editJobName.trim() || !editJobAddress.trim()) { setFormError("Enter job name and address"); return }
    setSaving(true); setFormError("")
    const { error } = await supabase.from("jobs").update({ name: editJobName.trim(), address: editJobAddress.trim(), checklist_template_id: editJobTemplateId || null }).eq("id", jobId)
    if (error) { setFormError(error.message); setSaving(false); return }
    setEditingJobId(null); setSaving(false)
    router.refresh()
  }

  async function addMember() {
    if (!memberName.trim() || !memberEmail.trim()) { setFormError("Enter name and email"); return }
    setSaving(true); setFormError("")
    const initials = memberName.trim().split(" ").map((n: any) => n[0]).join("").toUpperCase().slice(0, 2)
    const { error } = await supabase.from("users").insert({ company_id: userData.company_id, name: memberName.trim(), email: memberEmail.trim(), initials, role: "installer", is_active: true })
    if (error) { setFormError(error.message); setSaving(false); return }
    try { await fetch("/api/invite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: memberEmail.trim(), name: memberName.trim() }) }) } catch(e) {}
    setMemberName(""); setMemberEmail(""); setShowAddMember(false); setSaving(false)
    router.refresh()
  }

  async function toggleAssignment(jobId: string, userId: string) {
    const existing = jobAssignments.find((a) => a.job_id === jobId && a.user_id === userId)
    if (existing) { await supabase.from("job_assignments").delete().eq("id", existing.id) }
    else { await supabase.from("job_assignments").insert({ job_id: jobId, user_id: userId, company_id: userData.company_id }) }
    router.refresh()
  }

  async function addTemplate() {
    if (!templateName.trim()) { setFormError("Enter template name"); return }
    setSaving(true); setFormError("")
    const res = await fetch("/api/checklist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create_template", name: templateName.trim() }) })
    if (!res.ok) { const d = await res.json(); setFormError(d.error); setSaving(false); return }
    setTemplateName(""); setShowAddTemplate(false); setSaving(false)
    router.refresh()
  }

  async function addItem(templateId: string) {
    if (!itemLabel.trim()) { setFormError("Enter item label"); return }
    setSaving(true); setFormError("")
    const res = await fetch("/api/checklist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "add_item", templateId, label: itemLabel.trim(), item_type: itemType, is_mandatory: itemMandatory, requires_photo: itemPhoto, requires_video: itemVideo, fail_note_required: itemFailNote }) })
    if (!res.ok) { const d = await res.json(); setFormError(d.error); setSaving(false); return }
    setItemLabel(""); setItemType("tick"); setItemMandatory(false); setItemPhoto(false); setItemVideo(false); setItemFailNote(false); setShowAddItem(null); setSaving(false)
    router.refresh()
  }

  async function deleteItem(itemId: string) {
    await fetch("/api/checklist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete_item", itemId }) })
    router.refresh()
  }

  async function deleteTemplate(templateId: string) {
    if (!window.confirm("Delete this template and all its items?")) return
    await fetch("/api/checklist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete_template", templateId }) })
    router.refresh()
  }

  const installers = teamMembers.filter((m: any) => m.role === "installer")
  const getAssigned = (jobId: string) => {
    const ids = jobAssignments.filter((a: any) => a.job_id === jobId).map((a: any) => a.user_id)
    return teamMembers.filter((m: any) => ids.includes(m.id))
  }

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "analytics", label: "Analytics" },
    { id: "approvals", label: "Approvals", badge: pendingQA.length },
    { id: "jobs", label: "Jobs" },
    { id: "team", label: "Team" },
    { id: "checklists", label: "Checklists" },
    { id: "diary", label: "Diary" },
    { id: "payroll", label: "Payroll" },
    { id: "alerts", label: "Alerts", badge: alerts.length },
  ]

  const inp = "w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-gray-900 placeholder-gray-400 focus:outline-none focus:border-teal-400 text-sm"
  const card = "bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm"
  const cardHeader = "flex items-center justify-between px-6 py-4 border-b border-gray-100"
  const sub = "text-gray-500"
  const btn = "bg-teal-400 hover:bg-teal-500 text-white font-bold rounded-xl px-5 py-2.5 text-sm transition-colors"
  const btnGhost = "bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl px-5 py-2.5 text-sm transition-colors"
  const itemTypeOptions = [
    { value: "tick", label: "Tick only" },
    { value: "photo", label: "Photo required" },
    { value: "pass_fail", label: "Pass / Fail" },
    { value: "measurement", label: "Measurement" },
  ]

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="bg-white border-b border-gray-200 px-8 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-teal-400 flex items-center justify-center flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
              <rect x="2" y="2" width="7" height="7" rx="1.5" fill="white"/>
              <rect x="11" y="2" width="7" height="7" rx="1.5" fill="white" opacity="0.7"/>
              <rect x="2" y="11" width="7" height="7" rx="1.5" fill="white" opacity="0.7"/>
              <rect x="11" y="11" width="7" height="7" rx="1.5" fill="white" opacity="0.4"/>
            </svg>
          </div>
          <div>
            <div className="font-bold text-base">Van<span className="text-teal-500">tro</span></div>
            <div className="text-xs text-gray-500">Field Operations</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-teal-50 border border-teal-200 rounded-full px-4 py-1.5">
            <div className="w-2 h-2 rounded-full bg-teal-400 animate-pulse"/>
            <span className="text-sm text-teal-700 font-semibold">{signins.length} on site</span>
          </div>
          <button onClick={handleSignOut} className="text-sm text-gray-500 hover:text-gray-900 border border-gray-200 rounded-full px-4 py-1.5">Sign out</button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 px-8 py-6">
        {[
          { label: "On Site Now", value: signins.length, color: "text-teal-500" },
          { label: "Active Jobs", value: jobs.filter((j: any) => j.status === "active").length, color: "text-gray-900" },
          { label: "Awaiting Approval", value: pendingQA.length, color: "text-amber-500" },
          { label: "Unread Alerts", value: alerts.length, color: "text-red-500" },
        ].map(s => (
          <div key={s.label} className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
            <div className="text-gray-500 text-sm font-medium mb-2">{s.label}</div>
            <div className={"text-4xl font-bold " + s.color}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="flex border-b border-gray-200 px-8 bg-white overflow-x-auto">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => switchTab(tab.id)}
            className={"flex items-center gap-2 px-4 py-4 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap " + (activeTab === tab.id ? "border-teal-400 text-teal-600" : "border-transparent text-gray-500 hover:text-gray-900")}>
            {tab.label}
            {tab.badge ? <span className="bg-teal-50 text-teal-600 text-xs font-bold px-2 py-0.5 rounded-full">{tab.badge}</span> : null}
          </button>
        ))}
      </div>

      <div className="px-8 py-6 max-w-6xl">

        {activeTab === "overview" && (
          <div className="grid grid-cols-2 gap-5">
            <div className={card}>
              <div className={cardHeader}>
                <span className="font-semibold">Live on site</span>
                <span className="text-sm bg-teal-50 text-teal-600 px-3 py-1 rounded-full">{signins.length} active</span>
              </div>
              {signins.length === 0 ? <div className={"px-6 py-10 text-center " + sub}>No one signed in yet today</div>
              : signins.map((s: any) => (
                <div key={s.id} className="flex items-center gap-4 px-6 py-4 border-b border-gray-50 last:border-0">
                  <div className="w-10 h-10 rounded-full bg-teal-50 flex items-center justify-center text-sm font-bold text-teal-600">{s.users?.initials || "?"}</div>
                  <div className="flex-1"><div className="font-semibold">{s.users?.name}</div><div className={"text-sm " + sub}>In at {new Date(s.signed_in_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</div></div>
                  <span className="text-sm text-teal-500 font-medium">On site</span>
                </div>
              ))}
            </div>
            <div className={card}>
              <div className={cardHeader}>
                <span className="font-semibold">Recent alerts</span>
                {alerts.length > 0 && <span className="text-sm bg-red-50 text-red-500 px-3 py-1 rounded-full">{alerts.length} unread</span>}
              </div>
              {alerts.length === 0 ? <div className={"px-6 py-10 text-center " + sub}>No alerts - all clear</div>
              : alerts.slice(0, 5).map((a: any) => (
                <div key={a.id} className="px-6 py-4 border-b border-gray-50 last:border-0">
                  <div className={"text-xs " + sub + " mb-1"}>{a.jobs?.name}</div>
                  <div className="text-sm">{a.message}</div>
                </div>
              ))}
            </div>
            <div className={card + " col-span-2"}>
              <div className={cardHeader}>
                <span className="font-semibold">Active jobs</span>
                <span className={"text-sm " + sub}>{jobs.length} total</span>
              </div>
              {jobs.length === 0 ? <div className={"px-6 py-10 text-center " + sub}>No jobs yet</div>
              : jobs.slice(0, 6).map((j: any) => {
                const assigned = getAssigned(j.id)
                return (
                  <div key={j.id} className="flex items-center gap-4 px-6 py-4 border-b border-gray-50 last:border-0">
                    <div className="flex-1"><div className="font-semibold">{j.name}</div><div className={"text-sm " + sub}>{j.address}</div></div>
                    {assigned.length > 0 && <div className="flex gap-1">{assigned.map((a: any) => <div key={a.id} className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold">{a.initials}</div>)}</div>}
                    <span className={"text-sm px-3 py-1 rounded-full font-medium " + (j.status === "active" ? "bg-teal-50 text-teal-600" : "bg-gray-100 text-gray-500")}>{j.status}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {activeTab === "analytics" && (
          <AnalyticsTab companyId={userData.company_id} teamMembers={teamMembers} jobs={jobs} />
        )}
        {activeTab === "approvals" && (
          <div className={card}>
            <div className={cardHeader}><span className="font-semibold">QA approval queue</span></div>
            {pendingQA.length === 0 ? <div className={"px-6 py-16 text-center " + sub}>Nothing waiting for approval</div>
            : pendingQA.map((qa: any) => (
              <div key={qa.id} className="px-6 py-5 border-b border-gray-50 last:border-0">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <div className="w-8 h-8 rounded-full bg-teal-50 flex items-center justify-center text-sm font-bold text-teal-600">{qa.users?.initials || "?"}</div>
                      <span className="font-semibold">{qa.users?.name}</span>
                      <span className={"text-sm " + sub}>on {qa.jobs?.name}</span>
                    </div>
                    {qa.notes && <div className={"text-sm " + sub}>Note: {qa.notes}</div>}
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => approveQA(qa.id)} className="bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 rounded-xl px-4 py-2 text-sm font-semibold">Approve</button>
                    <button onClick={() => { const note = window.prompt("Rejection reason:"); if (note) rejectQA(qa.id, note) }} className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded-xl px-4 py-2 text-sm font-semibold">Reject</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === "jobs" && (
          <div className="space-y-5">
            <div className="flex justify-end"><button onClick={() => { setShowAddJob(true); setFormError("") }} className={btn}>+ Add job</button></div>
            {showAddJob && (
              <div className="bg-white border border-teal-200 rounded-2xl p-6 space-y-4 shadow-sm">
                <h3 className="font-semibold">New job</h3>
                <input value={jobName} onChange={e => setJobName(e.target.value)} placeholder="Job name" className={inp}/>
                <input value={jobAddress} onChange={e => setJobAddress(e.target.value)} placeholder="Site address" className={inp}/>
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">Checklist template (optional)</label>
                  <select value={jobTemplateId} onChange={e => setJobTemplateId(e.target.value)} className={inp}>
                    <option value="">No checklist</option>
                    {checklistTemplates.map((t: any) => <option key={t.id} value={t.id}>{t.name} ({t.checklist_items?.length || 0} items)</option>)}
                  </select>
                </div>
                {formError && <p className="text-sm text-red-500">{formError}</p>}
                <div className="flex gap-3">
                  <button onClick={addJob} disabled={saving} className={btn}>{saving ? "Saving..." : "Save job"}</button>
                  <button onClick={() => setShowAddJob(false)} className={btnGhost}>Cancel</button>
                </div>
              </div>
            )}
            <div className={card}>
              <div className={cardHeader}><span className="font-semibold">All jobs</span></div>
              {jobs.length === 0 ? <div className={"px-6 py-16 text-center " + sub}>No jobs yet</div>
              : jobs.map((j: any) => {
                const assigned = getAssigned(j.id)
                const isAssigning = assigningJobId === j.id
                const template = checklistTemplates.find((t) => t.id === j.checklist_template_id)
                return (
                  <div key={j.id} className="border-b border-gray-50 last:border-0">
                    <div className="flex items-center gap-4 px-6 py-5">
                      <div className="flex-1">
                        <div className="font-semibold">{j.name}</div>
                        <div className={"text-sm " + sub + " mt-0.5"}>{j.address}</div>
                        {template && <div className="text-xs text-teal-600 mt-1">Checklist: {template.name}</div>}
                        {assigned.length > 0 && (
                          <div className="flex gap-2 mt-2 flex-wrap">
                            {assigned.map((a: any) => <span key={a.id} className="text-xs bg-teal-50 text-teal-700 px-2 py-1 rounded-lg font-medium">{a.name}</span>)}
                          </div>
                        )}
                      </div>
                      <button onClick={() => { setEditingJobId(editingJobId === j.id ? null : j.id); setEditJobName(j.name); setEditJobAddress(j.address); setEditJobTemplateId(j.checklist_template_id || ""); setFormError("") }} className="text-sm border border-gray-200 text-gray-600 hover:border-teal-300 hover:text-teal-600 rounded-xl px-4 py-2 transition-colors flex-shrink-0">
                        {editingJobId === j.id ? "Cancel" : "Edit"}
                      </button>
                      <button onClick={() => setAssigningJobId(isAssigning ? null : j.id)} className="text-sm border border-gray-200 text-gray-600 hover:border-teal-300 hover:text-teal-600 rounded-xl px-4 py-2 transition-colors flex-shrink-0">
                        {isAssigning ? "Done" : "Assign"}
                      </button>
                      <span className={"text-sm px-3 py-1 rounded-full font-medium flex-shrink-0 " + (j.status === "active" ? "bg-teal-50 text-teal-600" : "bg-gray-100 text-gray-500")}>{j.status}</span>
                    </div>
                    {editingJobId === j.id && (
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
                    {isAssigning && (
                      <div className="px-6 pb-5">
                        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                          <p className={"text-sm " + sub + " mb-3"}>Click to assign or unassign</p>
                          {installers.length === 0 ? <p className={"text-sm " + sub}>No installers yet</p>
                          : <div className="flex flex-wrap gap-2">
                            {installers.map((m: any) => {
                              const isAssigned = jobAssignments.some((a) => a.job_id === j.id && a.user_id === m.id)
                              return (
                                <button key={m.id} onClick={() => toggleAssignment(j.id, m.id)}
                                  className={"flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors " + (isAssigned ? "bg-teal-400 text-white" : "bg-white text-gray-700 border border-gray-200 hover:border-teal-300")}>
                                  <div className="w-6 h-6 rounded-full bg-black/10 flex items-center justify-center text-xs font-bold">{m.initials}</div>
                                  {m.name}{isAssigned && " check"}
                                </button>
                              )
                            })}
                          </div>}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {activeTab === "team" && (
          <div className="space-y-5">
            <div className="flex justify-end"><button onClick={() => { setShowAddMember(true); setFormError("") }} className={btn}>+ Add member</button></div>
            {showAddMember && (
              <div className="bg-white border border-teal-200 rounded-2xl p-6 space-y-4 shadow-sm">
                <h3 className="font-semibold">New team member</h3>
                <p className="text-sm text-gray-500">They will receive an email invite to set up their account.</p>
                <input value={memberName} onChange={e => setMemberName(e.target.value)} placeholder="Full name" className={inp}/>
                <input value={memberEmail} onChange={e => setMemberEmail(e.target.value)} placeholder="Email address" type="email" className={inp}/>
                {formError && <p className="text-sm text-red-500">{formError}</p>}
                <div className="flex gap-3">
                  <button onClick={addMember} disabled={saving} className={btn}>{saving ? "Saving..." : "Save and send invite"}</button>
                  <button onClick={() => setShowAddMember(false)} className={btnGhost}>Cancel</button>
                </div>
              </div>
            )}
            <div className={card}>
              <div className={cardHeader}><span className="font-semibold">Team members</span></div>
              {teamMembers.length === 0 ? <div className={"px-6 py-16 text-center " + sub}>No team members yet</div>
              : teamMembers.map((m: any) => (
                <div key={m.id} className="flex items-center gap-4 px-6 py-5 border-b border-gray-50 last:border-0">
                  <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center font-bold flex-shrink-0">{m.initials}</div>
                  <div className="flex-1"><div className="font-semibold">{m.name}</div><div className={"text-sm " + sub + " mt-0.5"}>{m.email || "No email"}</div></div>
                  <span className="text-sm bg-gray-100 text-gray-600 px-3 py-1 rounded-full capitalize font-medium">{m.role}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "checklists" && (
          <div className="space-y-5">
            <div className="flex justify-end"><button onClick={() => { setShowAddTemplate(true); setFormError("") }} className={btn}>+ New template</button></div>
            {showAddTemplate && (
              <div className="bg-white border border-teal-200 rounded-2xl p-6 space-y-4 shadow-sm">
                <h3 className="font-semibold">New checklist template</h3>
                <input value={templateName} onChange={e => setTemplateName(e.target.value)} placeholder="e.g. Glazing Installation QA" className={inp}/>
                {formError && <p className="text-sm text-red-500">{formError}</p>}
                <div className="flex gap-3">
                  <button onClick={addTemplate} disabled={saving} className={btn}>{saving ? "Saving..." : "Create template"}</button>
                  <button onClick={() => setShowAddTemplate(false)} className={btnGhost}>Cancel</button>
                </div>
              </div>
            )}
            {checklistTemplates.length === 0 ? (
              <div className={card}><div className={"px-6 py-16 text-center " + sub}>No checklist templates yet. Create one to attach to jobs.</div></div>
            ) : checklistTemplates.map((t: any) => (
              <div key={t.id} className={card}>
                <div className={cardHeader}>
                  <div>
                    <span className="font-semibold">{t.name}</span>
                    <span className={"text-sm " + sub + " ml-3"}>{t.checklist_items?.length || 0} items</span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => { setShowAddItem(t.id); setFormError("") }} className="text-sm bg-teal-50 text-teal-600 hover:bg-teal-100 border border-teal-200 rounded-xl px-3 py-1.5 font-medium">+ Add item</button>
                    <button onClick={() => deleteTemplate(t.id)} className="text-sm bg-red-50 text-red-500 hover:bg-red-100 border border-red-200 rounded-xl px-3 py-1.5 font-medium">Delete</button>
                  </div>
                </div>
                {showAddItem === t.id && (
                  <div className="px-6 py-5 border-b border-gray-100 bg-gray-50 space-y-3">
                    <h4 className="text-sm font-semibold">New checklist item</h4>
                    <input value={itemLabel} onChange={e => setItemLabel(e.target.value)} placeholder="Item label e.g. Check sealant cured" className={inp}/>
                    <div>
                      <label className="block text-sm font-medium text-gray-600 mb-1">Type</label>
                      <select value={itemType} onChange={e => setItemType(e.target.value)} className={inp}>
                        {itemTypeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-wrap gap-4">
                      {[
                        { key: "mandatory", label: "Mandatory", state: itemMandatory, set: setItemMandatory },
                        { key: "photo", label: "Photo required", state: itemPhoto, set: setItemPhoto },
                        { key: "video", label: "Video required", state: itemVideo, set: setItemVideo },
                        { key: "failnote", label: "Note required on fail", state: itemFailNote, set: setItemFailNote },
                      ].map(opt => (
                        <label key={opt.key} className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={opt.state} onChange={e => opt.set(e.target.checked)} className="w-4 h-4 accent-teal-500"/>
                          <span className="text-sm text-gray-700">{opt.label}</span>
                        </label>
                      ))}
                    </div>
                    {formError && <p className="text-sm text-red-500">{formError}</p>}
                    <div className="flex gap-3">
                      <button onClick={() => addItem(t.id)} disabled={saving} className={btn}>{saving ? "Saving..." : "Add item"}</button>
                      <button onClick={() => setShowAddItem(null)} className={btnGhost}>Cancel</button>
                    </div>
                  </div>
                )}
                {(!t.checklist_items || t.checklist_items.length === 0) ? (
                  <div className={"px-6 py-8 text-center " + sub + " text-sm"}>No items yet</div>
                ) : t.checklist_items.sort((a: any, b: any) => a.sort_order - b.sort_order).map((item: any) => (
                  <div key={item.id} className="flex items-center gap-4 px-6 py-4 border-b border-gray-50 last:border-0">
                    <div className="flex-1">
                      <div className="font-medium text-sm">{item.label}</div>
                      <div className="flex gap-2 mt-1 flex-wrap">
                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{itemTypeOptions.find(o => o.value === item.item_type)?.label || item.item_type}</span>
                        {item.is_mandatory && <span className="text-xs bg-red-50 text-red-500 px-2 py-0.5 rounded-full">Mandatory</span>}
                        {item.requires_photo && <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">Photo</span>}
                        {item.requires_video && <span className="text-xs bg-purple-50 text-purple-600 px-2 py-0.5 rounded-full">Video</span>}
                        {item.fail_note_required && <span className="text-xs bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full">Note on fail</span>}
                      </div>
                    </div>
                    <button onClick={() => deleteItem(item.id)} className={"text-xs " + sub + " hover:text-red-500 transition-colors"}>Remove</button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {activeTab === "diary" && (
          <div className={card}>
            <div className={cardHeader}>
              <span className="font-semibold">Site diary - all jobs</span>
              <span className={"text-sm " + sub}>{diaryEntries.length} entries</span>
            </div>
            {diaryEntries.length === 0 ? <div className={"px-6 py-16 text-center " + sub}>No diary entries yet</div>
            : diaryEntries.map((d: any) => (
              <div key={d.id} className="px-6 py-5 border-b border-gray-50 last:border-0">
                <div className="flex items-start gap-4">
                  <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-sm font-bold flex-shrink-0">{d.users?.initials || "?"}</div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1">
                      <span className="font-semibold text-sm">{d.users?.name || "Unknown"}</span>
                      <span className={"text-xs " + sub}>{d.jobs?.name}</span>
                      <span className={"text-xs " + sub}>{new Date(d.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                    <p className="text-sm text-gray-700">{d.entry_text}</p>
                  </div>
                  {d.ai_processed && <span className="text-xs bg-amber-50 text-amber-600 border border-amber-200 px-2 py-1 rounded-full flex-shrink-0 font-medium">AI alert fired</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === "payroll" && (
          <PayrollTab teamMembers={teamMembers} />
        )}
        {activeTab === "alerts" && (
          <div className={card}>
            <div className={cardHeader}><span className="font-semibold">SiteLog alerts</span></div>
            {alerts.length === 0 ? <div className={"px-6 py-16 text-center " + sub}>No alerts - all clear</div>
            : alerts.map((a: any) => (
              <div key={a.id} className="px-6 py-5 border-b border-gray-50 last:border-0">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className={"text-xs " + sub + " mb-1"}>{a.jobs?.name} - {new Date(a.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</div>
                    <div className="text-sm">{a.message}</div>
                  </div>
                  <button onClick={() => markAlertRead(a.id)} className={"text-sm " + sub + " hover:text-gray-900 border border-gray-200 rounded-lg px-3 py-1.5"}>Dismiss</button>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  )
}


