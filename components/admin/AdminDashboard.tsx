"use client"
import PayrollTab from "@/components/admin/PayrollTab"
import ApprovalsTab from "@/components/admin/ApprovalsTab"
import DefectsTab from "@/components/admin/DefectsTab"
import AnalyticsTab from "@/components/admin/AnalyticsTab"
import { useState, useEffect, useRef } from "react"
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
  const [jobFilter, setJobFilter] = useState("active")
  const [editingJobId, setEditingJobId] = useState(null)
  const [editJobName, setEditJobName] = useState("")
  const [editJobAddress, setEditJobAddress] = useState("")
  const [editJobTemplateId, setEditJobTemplateId] = useState("")
  const [jobName, setJobName] = useState("")
  const [jobAddress, setJobAddress] = useState("")
  const [jobTemplateId, setJobTemplateId] = useState("")
  const [jobLat, setJobLat] = useState(null)
  const [jobLng, setJobLng] = useState(null)
  const [jobPlaceSelected, setJobPlaceSelected] = useState(false)
  const [editJobPlaceSelected, setEditJobPlaceSelected] = useState(false)
  const [editJobLat, setEditJobLat] = useState(null)
  const [editJobStatus, setEditJobStatus] = useState("")
  const [editJobLng, setEditJobLng] = useState(null)
  const addAddressRef = useRef(null)
  const editAddressRef = useRef(null)
  const [memberName, setMemberName] = useState("")
  const [memberEmail, setMemberEmail] = useState("")
  const [memberRole, setMemberRole] = useState("installer")
  const [templateName, setTemplateName] = useState("")
  const [itemLabel, setItemLabel] = useState("")
  const [itemType, setItemType] = useState("tick")
  const [itemMandatory, setItemMandatory] = useState(false)
  const [itemPhoto, setItemPhoto] = useState(false)
  const [itemVideo, setItemVideo] = useState(false)
  const [itemFailNote, setItemFailNote] = useState(false)
  const [saving, setSaving] = useState(false)
  const [resolvingAlert, setResolvingAlert] = useState<string|null>(null)
  const [resolutionNote, setResolutionNote] = useState("")
  const [formError, setFormError] = useState("")
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY
    if (!key) return
    function init() {
      if (!(window as any).google) return
      if (addAddressRef.current) {
        const ac = new (window as any).google.maps.places.Autocomplete(addAddressRef.current, { types: ["address"] })
        ac.addListener("place_changed", () => {
          const place = ac.getPlace()
          if (place.formatted_address) setJobAddress(place.formatted_address)
          if (place.geometry?.location) { setJobLat(place.geometry.location.lat()); setJobLng(place.geometry.location.lng()) }
          setJobPlaceSelected(true)
        })
      }
      if (editAddressRef.current) {
        const ac2 = new (window as any).google.maps.places.Autocomplete(editAddressRef.current, { types: ["address"] })
        ac2.addListener("place_changed", () => {
          const place = ac2.getPlace()
          if (place.formatted_address) setEditJobAddress(place.formatted_address)
          if (place.geometry?.location) { setEditJobLat(place.geometry.location.lat()); setEditJobLng(place.geometry.location.lng()) }
          setEditJobPlaceSelected(true)
        })
      }
    }
    if ((window as any).google) { init(); return }
    if (!document.getElementById("gmaps")) {
      const s = document.createElement("script")
      s.id = "gmaps"
      s.src = "https://maps.googleapis.com/maps/api/js?key=" + key + "&libraries=places"
      s.async = true
      s.onload = init
      document.head.appendChild(s)
    }
  }, [showAddJob, editingJobId])

  function switchTab(tab: string) {
    setActiveTab(tab)
    try { localStorage.setItem("vantro_tab", tab) } catch {}
  }

  async function handleSignOut() { await supabase.auth.signOut(); router.push("/login") }
  async function approveQA(id: string) { await supabase.from("qa_submissions").update({ state: "approved", reviewed_at: new Date().toISOString() }).eq("id", id); router.refresh() }
  async function rejectQA(id: string, note: string) { await supabase.from("qa_submissions").update({ state: "rejected", rejection_note: note, reviewed_at: new Date().toISOString() }).eq("id", id); router.refresh() }
  async function resolveAlert(id: string) {
    if (!resolutionNote.trim()) { alert("Please enter a resolution note"); return }
    setSaving(true)
    await fetch("/api/alerts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ alertId: id, resolutionNote }) })
    setResolvingAlert(null)
    setResolutionNote("")
    setSaving(false)
    router.refresh()
  }

  async function markAlertRead(id: string) { await supabase.from("alerts").update({ is_read: true }).eq("id", id); router.refresh() }

  async function addJob() {
    if (!jobName.trim()) { setFormError("Enter a job name"); return }
    if (!jobPlaceSelected) { setFormError("Select an address from the dropdown - do not just type it"); return }
    setSaving(true); setFormError("")
    const { error } = await supabase.from("jobs").insert({ company_id: userData.company_id, name: jobName.trim(), address: jobAddress.trim(), status: "active", checklist_template_id: jobTemplateId || null, lat: jobLat, lng: jobLng })
    if (error) { setFormError(error.message); setSaving(false); return }
    setJobName(""); setJobAddress(""); setJobTemplateId(""); setJobPlaceSelected(false); setShowAddJob(false); setSaving(false)
    router.refresh()
  }

  async function updateJob(jobId: string) {
    if (!editJobName.trim()) { setFormError("Enter a job name"); return }
    if (!editJobPlaceSelected) { setFormError("Select an address from the dropdown - do not just type it"); return }
    setSaving(true); setFormError("")
    const { error } = await supabase.from("jobs").update({ name: editJobName.trim(), address: editJobAddress.trim(), checklist_template_id: editJobTemplateId || null, lat: editJobLat, lng: editJobLng, status: editJobStatus || "active" }).eq("id", jobId)
    if (error) { setFormError(error.message); setSaving(false); return }
    setEditingJobId(null); setSaving(false)
    router.refresh()
  }

  async function deleteJob(jobId: string, jobName: string) {
    if (!window.confirm("Delete job: " + jobName + "? This cannot be undone.")) return
    const res = await fetch("/api/jobs/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId }) })
    if (res.ok) { window.location.href = "/admin?tab=jobs" }
    else { const d = await res.json(); alert("Failed to delete: " + d.error) }
  }

  async function addMember() {
    if (!memberName.trim() || !memberEmail.trim()) { setFormError("Enter name and email"); return }
    setSaving(true); setFormError("")
    const initials = memberName.trim().split(" ").map((n: any) => n[0]).join("").toUpperCase().slice(0, 2)
    const { error } = await supabase.from("users").insert({ company_id: userData.company_id, name: memberName.trim(), email: memberEmail.trim(), initials, role: memberRole, is_active: true })
    if (error) { setFormError(error.message); setSaving(false); return }
    try { await fetch("/api/invite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: memberEmail.trim(), name: memberName.trim(), role: memberRole }) }) } catch(e) {}
    setMemberName(""); setMemberEmail(""); setMemberRole("installer"); setShowAddMember(false); setSaving(false)
    router.refresh()
  }

  async function removeMember(userId: string, authUserId: string) {
    if (!window.confirm("Remove this member from your team? This cannot be undone.")) return
    const res = await fetch("/api/team/remove", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ authUserId, userId }) })
    if (res.ok) window.location.reload()
  }

  async function resendInvite(email: string, name: string) {
    const res = await fetch("/api/invite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, name }) })
    if (res.ok) { alert("Invite sent to " + email) }
    else { const d = await res.json(); alert("Failed: " + d.error) }
  }

  async function resetPin(userId: string) {
    if (!window.confirm("Reset this installer PIN? They will need to set a new one.")) return
    await supabase.from("users").update({ pin_hash: null }).eq("id", userId)
    alert("PIN reset. They will need to set a new PIN on next login.")
  }

  async function toggleActive(userId: string, current: boolean) {
    await supabase.from("users").update({ is_active: !current }).eq("id", userId)
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

  const installers = teamMembers.filter((m: any) => m.role === "installer" || m.role === "foreman")
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
    { id: "defects", label: "Defects" },
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

  const roleColors: any = {
    admin: "bg-purple-50 text-purple-700",
    foreman: "bg-blue-50 text-blue-700",
    installer: "bg-gray-100 text-gray-600",
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="bg-white border-b border-gray-200 px-4 md:px-8 py-4 flex items-center justify-between shadow-sm">
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 px-4 md:px-8 py-4 md:py-6">
        {[
          { label: "On Site Now", value: signins.length, color: "text-teal-500" },
          { label: "Active Jobs", value: jobs.filter((j: any) => j.status === "active").length, color: "text-gray-900" },
          { label: "Awaiting Approval", value: pendingQA.length, color: "text-amber-500" },
          { label: "Unread Alerts", value: alerts.length, color: "text-red-500" },
        ].map(s => (
          <div key={s.label} className="bg-white border border-gray-200 rounded-2xl p-4 md:p-6 shadow-sm">
            <div className="text-gray-500 text-xs md:text-sm font-medium mb-1 md:mb-2">{s.label}</div>
            <div className={"text-3xl md:text-4xl font-bold " + s.color}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="flex border-b border-gray-200 px-2 md:px-8 bg-white overflow-x-auto">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => switchTab(tab.id)}
            className={"flex items-center gap-2 px-3 md:px-4 py-4 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap " + (activeTab === tab.id ? "border-teal-400 text-teal-600" : "border-transparent text-gray-500 hover:text-gray-900")}>
            {tab.label}
            {tab.badge ? <span className="bg-teal-50 text-teal-600 text-xs font-bold px-2 py-0.5 rounded-full">{tab.badge}</span> : null}
          </button>
        ))}
      </div>

      <div className="px-4 md:px-8 py-4 md:py-6 max-w-6xl">

        {activeTab === "overview" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
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
                <div key={a.id} className={"px-6 py-4 border-b border-gray-50 last:border-0" + (a.alert_type === "blocker" ? " border-l-4 border-l-red-400" : "")}>
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    {a.alert_type === "blocker" && <span className="text-xs bg-red-50 text-red-600 px-2 py-0.5 rounded-full font-bold border border-red-200">BLOCKER</span>}
                    {a.alert_type === "issue" && <span className="text-xs bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full border border-amber-200">ISSUE</span>}
                    <span className={"text-xs font-medium text-gray-700"}>{a.jobs?.name}</span>
                    <span className={"text-xs " + sub}>{new Date(a.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                  <div className="text-sm text-gray-600">{a.message}</div>
                </div>
              ))}
            </div>
            <div className={card + " md:col-span-2"}>
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

        {activeTab === "analytics" && <AnalyticsTab companyId={userData.company_id} teamMembers={teamMembers} jobs={jobs} />}
        {activeTab === "approvals" && <ApprovalsTab key={activeTab + Date.now().toString().slice(0,-4)} pendingQA={pendingQA} onRefresh={() => router.refresh()} />}

        {activeTab === "jobs" && (
          <div className="space-y-5">
            <div className="flex justify-end"><button onClick={() => { setShowAddJob(true); setFormError("") }} className={btn}>+ Add job</button></div>
            {showAddJob && (
              <div className="bg-white border border-teal-200 rounded-2xl p-6 space-y-4 shadow-sm">
                <h3 className="font-semibold">New job</h3>
                <input value={jobName} onChange={e => setJobName(e.target.value)} placeholder="Job name" className={inp}/>
                <input ref={addAddressRef} value={jobAddress} onChange={e => { setJobAddress(e.target.value); setJobPlaceSelected(false) }} placeholder="Start typing address, then select from dropdown..." className={inp}/>
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
              <div className="px-6 pt-5 pb-3 flex gap-2 flex-wrap border-b border-gray-100">
                {["all","active","on_hold","completed","cancelled"].map((f: any) => (
                  <button key={f} onClick={() => setJobFilter(f)}
                    className={"px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors " + (jobFilter === f ? "bg-teal-400 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}>
                    {f === "all" ? "All" : f === "on_hold" ? "On hold" : f.charAt(0).toUpperCase() + f.slice(1)}
                    <span className="ml-1 opacity-70">{f === "all" ? jobs.length : jobs.filter((j: any) => j.status === f).length}</span>
                  </button>
                ))}
              </div>
              {jobs.filter((j: any) => jobFilter === "all" || j.status === jobFilter).length === 0 ? <div className={"px-6 py-16 text-center " + sub}>No jobs</div>
              : jobs.filter((j: any) => jobFilter === "all" || j.status === jobFilter).map((j: any) => {
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
                      <button onClick={() => { setEditingJobId(editingJobId === j.id ? null : j.id); setEditJobName(j.name); setEditJobAddress(j.address); setEditJobTemplateId(j.checklist_template_id || ""); setEditJobPlaceSelected(true); setFormError("") }} className="text-sm border border-gray-200 text-gray-600 hover:border-teal-300 hover:text-teal-600 rounded-xl px-4 py-2 transition-colors flex-shrink-0">
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
                          <input ref={editAddressRef} value={editJobAddress} onChange={e => { setEditJobAddress(e.target.value); setEditJobPlaceSelected(false) }} placeholder="Start typing address, then select from dropdown..." className={inp}/>
                          <div>
                            <label className="block text-sm font-medium text-gray-600 mb-1">Status</label>
                            <select value={editJobStatus || j.status} onChange={e => setEditJobStatus(e.target.value)} className={inp}>
                              <option value="active">Active</option>
                              <option value="on_hold">On hold</option>
                              <option value="completed">Completed</option>
                              <option value="cancelled">Cancelled</option>
                            </select>
                          </div>
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
                            <button onClick={() => deleteJob(j.id, j.name)} className="bg-red-50 hover:bg-red-100 text-red-500 border border-red-200 rounded-xl px-5 py-2.5 text-sm transition-colors">Delete</button>
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
                                  {m.name}{isAssigned && " ✓"}
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
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">Role</label>
                  <select value={memberRole} onChange={e => setMemberRole(e.target.value)} className={inp}>
                    <option value="installer">Installer — PIN app access only</option>
                    <option value="foreman">Foreman — PIN app + alert emails</option>
                  </select>
                </div>
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
                <div key={m.id} className="border-b border-gray-50 last:border-0">
                  <div className="flex items-center gap-4 px-6 py-5">
                    <div className={"w-10 h-10 rounded-full flex items-center justify-center font-bold flex-shrink-0 " + (m.is_active === false ? "bg-gray-100 text-gray-400" : "bg-gray-100 text-gray-900")}>{m.initials}</div>
                    <div className="flex-1">
                      <div className={"font-semibold " + (m.is_active === false ? "text-gray-400" : "")}>{m.name}</div>
                      <div className={"text-sm mt-0.5 " + sub}>{m.email || "No email"}</div>
                      {m.is_active === false && <span className="text-xs text-amber-500">Suspended</span>}
                      {!m.pin_hash && m.role === "installer" && <span className="text-xs text-red-400 ml-2">PIN not set</span>}
                    </div>
                    <span className={"text-sm px-3 py-1 rounded-full capitalize font-medium flex-shrink-0 " + (roleColors[m.role] || "bg-gray-100 text-gray-600")}>{m.role}</span>
                    {(m.role === "installer" || m.role === "foreman") && (
                      <div className="flex gap-2">
                        <button onClick={() => resendInvite(m.email, m.name)} className="text-xs border border-gray-200 text-gray-600 hover:border-teal-300 hover:text-teal-600 rounded-lg px-3 py-1.5 transition-colors">Resend invite</button>
                        <button onClick={() => resetPin(m.id)} className="text-xs border border-gray-200 text-gray-600 hover:border-amber-300 hover:text-amber-600 rounded-lg px-3 py-1.5 transition-colors">Reset PIN</button>
                        <button onClick={() => toggleActive(m.id, m.is_active !== false)} className={"text-xs border rounded-lg px-3 py-1.5 transition-colors " + (m.is_active === false ? "border-teal-200 text-teal-600 hover:bg-teal-50" : "border-gray-200 text-gray-600 hover:border-amber-300 hover:text-amber-600")}>{m.is_active === false ? "Reactivate" : "Suspend"}</button>
                        <button onClick={() => removeMember(m.id, m.auth_user_id)} className="text-xs border border-red-200 text-red-500 hover:bg-red-50 rounded-lg px-3 py-1.5 transition-colors">Remove</button>
                      </div>
                    )}
                  </div>
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
                  {d.ai_alert_type === 'blocker' && <span className="text-xs bg-red-50 text-red-600 border border-red-200 px-2 py-1 rounded-full flex-shrink-0 font-medium font-bold">ðŸš¨ BLOCKER</span>}
                  {d.ai_alert_type === 'issue' && <span className="text-xs bg-amber-50 text-amber-600 border border-amber-200 px-2 py-1 rounded-full flex-shrink-0 font-medium">âš ï¸ Issue</span>}
                  {d.ai_alert_type === 'none' && <span className="text-xs bg-gray-50 text-gray-400 border border-gray-200 px-2 py-1 rounded-full flex-shrink-0">Normal</span>}
                  {d.ai_summary && <span className="text-xs text-gray-500 italic ml-1">{d.ai_summary}</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === "payroll" && <PayrollTab teamMembers={teamMembers} />}
        {activeTab === "defects" && <DefectsTab />}

        {activeTab === "alerts" && (
          <div className={card}>
            <div className={cardHeader}><span className="font-semibold">Vantro alerts</span></div>
            {alerts.length === 0 ? <div className={"px-6 py-16 text-center " + sub}>No alerts - all clear</div>
            : alerts.map((a: any) => (
              <div key={a.id} className={"px-6 py-5 border-b border-gray-50 last:border-0" + (a.alert_type === "blocker" ? " border-l-4 border-l-red-400" : a.alert_type === "issue" ? " border-l-4 border-l-amber-400" : "")}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      {a.alert_type === "blocker" && <span className="text-xs bg-red-50 text-red-600 border border-red-200 px-2 py-0.5 rounded-full font-bold">BLOCKER</span>}
                      {a.alert_type === "issue" && <span className="text-xs bg-amber-50 text-amber-600 border border-amber-200 px-2 py-0.5 rounded-full font-semibold">ISSUE</span>}
                      <span className={"text-xs font-semibold " + (a.alert_type === "blocker" ? "text-red-600" : "text-gray-700")}>{a.jobs?.name}</span>
                      {a.users?.name && <span className="text-xs text-gray-400">logged by {a.users.name}</span>}
                      <span className={"text-xs " + sub}>{new Date(a.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                    <div className="text-sm text-gray-700">{a.message}</div>
                  </div>
                  <button onClick={() => { setResolvingAlert(resolvingAlert === a.id ? null : a.id); setResolutionNote("") }} className="text-sm bg-teal-50 text-teal-600 border border-teal-200 hover:bg-teal-100 rounded-lg px-3 py-1.5 flex-shrink-0 font-medium">Resolve</button>
                </div>
              {resolvingAlert === a.id && (
                <div className="mt-3 flex gap-2">
                  <input value={resolutionNote} onChange={e => setResolutionNote(e.target.value)} placeholder="Enter resolution note - sent to installer..." className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-400" onKeyDown={e => e.key === "Enter" && resolveAlert(a.id)} />
                  <button onClick={() => resolveAlert(a.id)} disabled={saving} className="bg-teal-400 hover:bg-teal-500 text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">{saving ? "Sending..." : "Send & resolve"}</button>
                </div>
              )}
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  )
}


