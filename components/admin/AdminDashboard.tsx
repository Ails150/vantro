"use client"
import MemberSchedule from "@/components/admin/MemberSchedule"
import PayrollTab from "@/components/admin/PayrollTab"
import ApprovalsTab from "@/components/admin/ApprovalsTab"
import AuditTab from './AuditTab'
import MapTab from './MapTab'
import DefectsTab from "@/components/admin/DefectsTab"
import AnalyticsTab from "@/components/admin/AnalyticsTab"
import ComplianceTab from "@/components/admin/ComplianceTab"
import SettingsTab from "@/components/admin/SettingsTab"
import { useState, useEffect, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"

interface Props {
  user: any; userData: any; company: any; jobs: any[]; signins: any[]; alerts: any[]
  pendingQA: any[]; teamMembers: any[]; jobAssignments: any[]
  checklistTemplates: any[]; diaryEntries: any[]; resolvedAlerts: any[]; defaultTab: string
}

export default function AdminDashboard({ user, userData, company, jobs, signins, alerts, pendingQA, teamMembers, jobAssignments, checklistTemplates, diaryEntries, resolvedAlerts, defaultTab }: Props) {
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
  const [jobStartTime, setJobStartTime] = useState("08:00")
  const [jobSignOutTime, setJobSignOutTime] = useState("17:00")
  const [editJobSignOutTime, setEditJobSignOutTime] = useState("17:00")
  const [assigningAll, setAssigningAll] = useState(false)
  const [editJobStartTime, setEditJobStartTime] = useState("08:00")
  const [editJobTemplateId, setEditJobTemplateId] = useState("")
  const [jobName, setJobName] = useState("")
  const [jobAddress, setJobAddress] = useState("")
  const [jobTemplateId, setJobTemplateId] = useState("")
  const [jobTemplateIds, setJobTemplateIds] = useState<string[]>([])
  const [jobAssignedMembers, setJobAssignedMembers] = useState<string[]>([])
  const [editJobTemplateIds, setEditJobTemplateIds] = useState<string[]>([])
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
  const [editingScheduleId, setEditingScheduleId] = useState<string|null>(null)
  const [scheduleSignIn, setScheduleSignIn] = useState("08:00")
  const [scheduleSignOut, setScheduleSignOut] = useState("17:00")
  const [scheduleDays, setScheduleDays] = useState<string[]>(["mon","tue","wed","thu","fri"])
  const [templateName, setTemplateName] = useState("")
  const [templateFrequency, setTemplateFrequency] = useState("job")
  const [editingTemplateId, setEditingTemplateId] = useState<string|null>(null)
  const [editTemplateName, setEditTemplateName] = useState("")
  const [editTemplateFrequency, setEditTemplateFrequency] = useState("job")
  const [itemLabel, setItemLabel] = useState("")
  const [itemType, setItemType] = useState("tick")
  const [itemMandatory, setItemMandatory] = useState(false)
  const [itemPhoto, setItemPhoto] = useState(false)
  const [itemVideo, setItemVideo] = useState(false)
  const [itemFailNote, setItemFailNote] = useState(false)
  const [saving, setSaving] = useState(false)
  const [resolvingAlert, setResolvingAlert] = useState<string|null>(null)
  const [alertFilter, setAlertFilter] = useState<'all'|'blocker'|'issue'|'24h'>('all')
  const [showResolved, setShowResolved] = useState(false)
  const [expandedJobGroups, setExpandedJobGroups] = useState<Set<string>>(new Set())
  const [diaryFilter, setDiaryFilter] = useState<'all'|'blocker'|'issue'|'photos'|'videos'|'24h'>('all')
  const [diarySearch, setDiarySearch] = useState('')
  const [resolutionNote, setResolutionNote] = useState("")
  const [replyingDiary, setReplyingDiary] = useState<string|null>(null)
  const [lightboxUrl, setLightboxUrl] = useState<string|null>(null)
  const [diaryReply, setDiaryReply] = useState("")
  const [replySending, setReplySending] = useState(false)
  const [invitingJobId, setInvitingJobId] = useState<string|null>(null)
  const [inviteName, setInviteName] = useState("")
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteSending, setInviteSending] = useState(false)
  const [toast, setToast] = useState<{message: string; type: string} | null>(null)

  function showToast(message: string, type: string = "info") {
    setToast({ message, type })
    setTimeout(() => setToast(null), 5000)
  }
  const [liveAlerts, setLiveAlerts] = useState<any[]>(alerts)
  const prevAlertCount = useRef(alerts.length)

  useEffect(() => {
    setLiveAlerts(alerts)
  }, [alerts])

  useEffect(() => {
    const interval = setInterval(async () => {
      const res = await fetch("/api/admin/alerts")
      if (res.ok) {
        const data = await res.json()
        const newAlerts = data.alerts || []
        if (newAlerts.length > prevAlertCount.current) {
          // New alert arrived - show toast
          const newest = newAlerts[0]
          showToast(
            (newest?.alert_type === "blocker" ? "BLOCKER" : "ISSUE") + " - " + (newest?.jobs?.name || "Unknown job") + (newest?.jobs?.name || "Job") + ": " + newest?.message,
            newest?.alert_type === "blocker" ? "blocker" : "issue"
          )
          // Play sound
          try {
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.connect(gain)
            gain.connect(ctx.destination)
            osc.frequency.value = 880
            gain.gain.value = 0.3
            osc.start()
            osc.stop(ctx.currentTime + 0.3)
            setTimeout(() => {
              osc.frequency.value = 1100
              osc.start(ctx.currentTime + 0.4)
              osc.stop(ctx.currentTime + 0.6)
            }, 400)
          } catch {}
        }
        prevAlertCount.current = newAlerts.length
        setLiveAlerts(newAlerts)
      }
    }, 30000)
    return () => clearInterval(interval)
  }, [])
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
  }, [])

  useEffect(() => {
    if (!showAddJob) return
    const interval = setInterval(() => {
      if (!(window as any).google || !addAddressRef.current) return
      clearInterval(interval)
      const ac = new (window as any).google.maps.places.Autocomplete(addAddressRef.current, { types: ["address"] })
      ac.addListener("place_changed", () => {
        const place = ac.getPlace()
        if (place.formatted_address) setJobAddress(place.formatted_address)
        if (place.geometry?.location) { setJobLat(place.geometry.location.lat()); setJobLng(place.geometry.location.lng()) }
        setJobPlaceSelected(true)
      })
    }, 100)
    return () => clearInterval(interval)
  }, [showAddJob])

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
    window.location.reload()
  }

  async function sendClientInvite(jobId: string) {
    if (!inviteName.trim() || !inviteEmail.trim()) { alert("Enter name and email"); return }
    setInviteSending(true)
    const res = await fetch("/api/client/invite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: inviteName, email: inviteEmail, jobId }) })
    const data = await res.json()
    setInviteSending(false)
    if (data.success) { setInvitingJobId(null); setInviteName(""); setInviteEmail(""); setToast({ message: "Client invite sent!", type: "success" }) }
    else { alert(data.error || "Failed to send invite") }
  }

  async function replyToDiary(entryId: string, userId: string) {
    if (!diaryReply.trim()) { alert("Please enter a reply"); return }
    setReplySending(true)
    await fetch("/api/diary/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryId, userId, message: diaryReply })
    })
    setReplyingDiary(null)
    setDiaryReply("")
    setReplySending(false)
  }

  async function markAlertRead(id: string) { await supabase.from("alerts").update({ is_read: true }).eq("id", id); router.refresh() }

  async function addJob() {
    if (!jobName.trim()) { setFormError("Enter a job name"); return }
    if (!jobPlaceSelected) { setFormError("Select an address from the dropdown - do not just type it"); return }
    setSaving(true); setFormError("")
    const { data: newJobData, error } = await supabase.from("jobs").insert({ company_id: userData.company_id, name: jobName.trim(), address: jobAddress.trim(), status: "active", checklist_template_id: jobTemplateId || null, lat: jobLat, lng: jobLng, start_time: jobStartTime, sign_out_time: jobSignOutTime }).select("id").single()
    if (error) { setFormError(error.message); setSaving(false); return }
    if (jobTemplateIds.length > 0 && newJobData) { for (const tid of jobTemplateIds) { await fetch("/api/checklist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "assign_to_job", jobId: newJobData.id, templateId: tid }) }) } }
    if (jobAssignedMembers.length > 0) { const newJob = await supabase.from("jobs").select("id").eq("company_id", userData.company_id).order("created_at", { ascending: false }).limit(1).single(); if (newJob.data) { for (const uid of jobAssignedMembers) { await supabase.from("job_assignments").upsert({ job_id: newJob.data.id, user_id: uid, company_id: userData.company_id }, { onConflict: "job_id,user_id" }) } } }
    setJobName(""); setJobAddress(""); setJobTemplateId(""); setJobTemplateIds([]); setJobAssignedMembers([]); setJobPlaceSelected(false); setShowAddJob(false); setSaving(false); setJobStartTime("08:00"); setJobSignOutTime("17:00")
    router.refresh()
  }

  async function updateJob(jobId: string) {
    if (!editJobName.trim()) { setFormError("Enter a job name"); return }
    if (!editJobPlaceSelected && !editJobLat) { setFormError("Select an address from the dropdown - do not just type it"); return }
    setSaving(true); setFormError("")
    const newStatus = editJobStatus || "active"
    const { error } = await supabase.from("jobs").update({ name: editJobName.trim(), address: editJobAddress.trim(), lat: editJobLat, lng: editJobLng, status: newStatus, start_time: editJobStartTime, sign_out_time: editJobSignOutTime }).eq("id", jobId)
    if (newStatus === "completed" || newStatus === "cancelled") {
      await supabase.from("signins").update({ signed_out_at: new Date().toISOString() }).eq("job_id", jobId).is("signed_out_at", null)
    }
    if (error) { setFormError(error.message); setSaving(false); return }
    await supabase.from("job_checklists").delete().eq("job_id", jobId)
    if (editJobTemplateIds.length > 0) {
      await supabase.from("job_checklists").insert(editJobTemplateIds.map((tid: string) => ({ job_id: jobId, template_id: tid })))
    }
    setEditingJobId(null); setSaving(false)
    window.location.reload()
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
    try {
      const res = await fetch("/api/invite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: memberEmail.trim(), name: memberName.trim(), role: memberRole }) })
      const data = await res.json()
      if (!res.ok) {
        const msg = data.error || ""
        if (msg.includes("duplicate") || msg.includes("unique")) {
          setFormError("That email address is already on your team.")
        } else {
          setFormError(msg || "Something went wrong. Please try again.")
        }
        setSaving(false)
        return
      }
    } catch(e) { setFormError("Something went wrong. Please try again."); setSaving(false); return }
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
    setTemplateName(""); setTemplateFrequency("job"); setShowAddTemplate(false); setSaving(false)
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

  async function saveEditTemplate(templateId: string) {
    await fetch("/api/checklist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update_template", templateId, name: editTemplateName, frequency: editTemplateFrequency }) })
    setEditingTemplateId(null)
    router.refresh()
  }
  async function deleteTemplate(templateId: string) {
    if (!window.confirm("Delete this template and all its items?")) return
    await fetch("/api/checklist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete_template", templateId }) })
    router.refresh()
  }

  async function saveSchedule(userId: string) {
    await fetch("/api/admin/team/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, sign_in_time: scheduleSignIn, sign_out_time: scheduleSignOut, working_days: scheduleDays })
    })
    setEditingScheduleId(null)
    router.refresh()
  }

  function openSchedule(m: any) {
    setEditingScheduleId(m.id)
    setScheduleSignIn(m.sign_in_time ? m.sign_in_time.slice(0,5) : "08:00")
    setScheduleSignOut(m.sign_out_time ? m.sign_out_time.slice(0,5) : "17:00")
    setScheduleDays(m.working_days || ["mon","tue","wed","thu","fri"])
  }

  const installers = teamMembers.filter((m: any) => m.role === "installer" || m.role === "foreman")
  const getAssigned = (jobId: string) => {
    const ids = jobAssignments.filter((a: any) => a.job_id === jobId).map((a: any) => a.user_id)
    return teamMembers.filter((m: any) => ids.includes(m.id))
  }

  const setupTabs = [
    { id: "team", label: "Team" },
    { id: "jobs", label: "Jobs" },
    { id: "checklists", label: "Checklists" },
    { id: "settings", label: "Settings" },
    { id: "alerts", label: "Alerts", badge: alerts.length },
  ]

  const operationsTabs = [
    { id: "overview", label: "Overview" },
    { id: "analytics", label: "Analytics" },
    { id: "performance", label: "Performance" },
    { id: "payroll", label: "Payroll" },
    { id: "map", label: "Map" },
    { id: "audit", label: "Audit" },
    { id: "approvals", label: "Approvals", badge: pendingQA.length },
    { id: "diary", label: "Diary" },
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

      <div className="flex">
        {/* Left Sidebar */}
        <div className="w-64 bg-white border-r border-gray-200 min-h-screen">
          <div className="p-6 space-y-6">
            {/* Setup Section */}
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Setup</h3>
              <nav className="space-y-1">
                {setupTabs.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => switchTab(tab.id)}
                    className={`w-full text-left px-3 py-2 text-sm font-medium rounded-lg transition-colors flex items-center justify-between ${
                      activeTab === tab.id 
                        ? 'bg-teal-50 text-teal-700 border-l-4 border-teal-400' 
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                    }`}
                  >
                    <span>{tab.label}</span>
                    {tab.badge ? <span className="bg-teal-100 text-teal-700 text-xs font-bold px-2 py-0.5 rounded-full">{tab.badge}</span> : null}
                  </button>
                ))}
              </nav>
            </div>

            {/* Operations Section */}
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Operations</h3>
              <nav className="space-y-1">
                {operationsTabs.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => switchTab(tab.id)}
                    className={`w-full text-left px-3 py-2 text-sm font-medium rounded-lg transition-colors flex items-center justify-between ${
                      activeTab === tab.id 
                        ? 'bg-teal-50 text-teal-700 border-l-4 border-teal-400' 
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                    }`}
                  >
                    <span>{tab.label}</span>
                    {tab.badge ? <span className="bg-teal-100 text-teal-700 text-xs font-bold px-2 py-0.5 rounded-full">{tab.badge}</span> : null}
                  </button>
                ))}
              </nav>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1">

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
              : liveAlerts.slice(0, 5).map((a: any) => (
                <div key={a.id} className={"px-6 py-4 border-b border-gray-50 last:border-0" + (a.alert_type === "blocker" ? " border-l-4 border-l-red-400" : "")}>
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    {a.alert_type === "blocker" && <span className="text-xs bg-red-50 text-red-600 px-2 py-0.5 rounded-full font-bold border border-red-200">"BLOCKER"</span>}
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
                    <div className="flex-1"><div className="font-semibold">{j.name}</div><div className={"text-sm " + sub}>{j.address}</div></div>{(j.job_checklists||[]).length > 0 && <div className="flex gap-1 mt-1">{(j.job_checklists||[]).map((jc:any) => <span key={jc.template_id} className="text-xs bg-teal-50 text-teal-600 border border-teal-200 rounded-full px-2 py-0.5">{checklistTemplates.find((t:any)=>t.id===jc.template_id)?.name||""}</span>)}</div>}
                    {assigned.length > 0 && <div className="flex gap-1">{assigned.map((a: any) => <div key={a.id} className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold">{a.initials}</div>)}</div>}
                    <span className={"text-sm px-3 py-1 rounded-full font-medium " + (j.status === "active" ? "bg-teal-50 text-teal-600" : "bg-gray-100 text-gray-500")}>{j.status}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {activeTab === "analytics" && <AnalyticsTab companyId={userData.company_id} teamMembers={teamMembers} jobs={jobs} />}
        {activeTab === "approvals" && <ApprovalsTab key={Date.now().toString()} pendingQA={pendingQA} onRefresh={() => router.refresh()} />}

        {activeTab === "jobs" && (
          <div className="space-y-5">
            <div className="flex justify-end"><button onClick={() => { setShowAddJob(true); setFormError("") }} className={btn}>+ Add job</button></div>
            {showAddJob && (
              <div className="bg-white border border-teal-200 rounded-2xl p-6 space-y-4 shadow-sm">
                <h3 className="font-semibold">New job</h3>
                <input value={jobName} onChange={e => setJobName(e.target.value)} placeholder="Job name" className={inp}/>
                <div className="relative">
                  <input ref={addAddressRef} value={jobAddress} onChange={e => { setJobAddress(e.target.value); setJobPlaceSelected(false) }} placeholder="Start typing address, then select from dropdown..." className={inp}/>
                  {jobAddress && (
                    <div className={"absolute right-3 top-3 text-xs font-semibold " + (jobPlaceSelected ? "text-teal-500" : "text-red-400")}>
                      {jobPlaceSelected ? "? GPS verified" : "? Select from dropdown"}
                    </div>
                  )}
                </div>
                <div>
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">Shift start time</label>
                  <input type="time" value={jobStartTime} onChange={e => setJobStartTime(e.target.value)} className={inp}/>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">Sign-out time (expected finish)</label>
                  <input type="time" value={jobSignOutTime} onChange={e => setJobSignOutTime(e.target.value)} className={inp}/>
                </div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">Assign team</label>
                  {teamMembers.filter((m: any) => m.role === "installer" || m.role === "foreman").length === 0 ? (
                    <p className="text-sm text-gray-400">No team yet - <button type="button" onClick={() => { setShowAddJob(false); setActiveTab("team") }} className="text-teal-600 underline">add team members first</button></p>
                  ) : (
                    <div className="space-y-2 mt-1">
                      {teamMembers.filter((m: any) => m.role === "installer" || m.role === "foreman").map((m: any) => (
                        <label key={m.id} className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={jobAssignedMembers?.includes(m.id) || false} onChange={e => setJobAssignedMembers((prev: string[]) => e.target.checked ? [...(prev||[]), m.id] : (prev||[]).filter((id: string) => id !== m.id))} className="w-4 h-4 accent-teal-500"/>
                          <span className="text-sm text-gray-700">{m.name}</span>
                          <span className="text-xs text-gray-400">{m.role}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">Checklists (optional)</label>
                  {checklistTemplates.length === 0 ? (
                    <p className="text-sm text-gray-400">No checklists yet ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â <button type="button" onClick={() => { setShowAddJob(false); setActiveTab("checklists") }} className="text-teal-600 underline">create a checklist first</button></p>
                  ) : (
                    <div className="space-y-2 mt-1">
                      {checklistTemplates.map((t: any) => (
                        <label key={t.id} className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={jobTemplateIds?.includes(t.id) || false} onChange={e => setJobTemplateIds((prev: string[]) => e.target.checked ? [...(prev||[]), t.id] : (prev||[]).filter((id: string) => id !== t.id))} className="w-4 h-4 accent-teal-500"/>
                          <span className="text-sm text-gray-700">{t.name}</span>
                          {t.requires_approval && <span className="text-xs bg-teal-50 text-teal-600 px-1.5 py-0.5 rounded">Approval</span>}
                          {t.audit_only && <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Audit</span>}
                        </label>
                      ))}
                    </div>
                  )}
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
                        {(j.job_checklists || []).map((jc: any) => <span key={jc.template_id} className="text-xs bg-teal-50 text-teal-600 px-2 py-0.5 rounded-full mr-1">{checklistTemplates.find((t:any) => t.id === jc.template_id)?.name}</span>)}
                        {assigned.length > 0 && (
                          <div className="flex gap-2 mt-2 flex-wrap">
                            {assigned.map((a: any) => <span key={a.id} className="text-xs bg-teal-50 text-teal-700 px-2 py-1 rounded-lg font-medium">{a.name}</span>)}
                          </div>
                        )}
                      </div>
                      <button onClick={() => { setEditingJobId(editingJobId === j.id ? null : j.id); setEditJobName(j.name); setEditJobAddress(j.address); setEditJobTemplateId(j.checklist_template_id || ""); setEditJobTemplateIds((j.job_checklists||[]).map((jc:any) => jc.template_id)); fetch('/api/admin/jobs/checklists?jobId='+j.id).then(r=>r.json()).then((d:any)=>{ if(d.templateIds) setEditJobTemplateIds(d.templateIds) }); setEditJobPlaceSelected(true); setEditJobSignOutTime(j.sign_out_time ? j.sign_out_time.slice(0, 5) : "17:00"); setFormError("") }} className="text-sm border border-gray-200 text-gray-600 hover:border-teal-300 hover:text-teal-600 rounded-xl px-4 py-2 transition-colors flex-shrink-0">
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
                            <label className="block text-sm font-medium text-gray-600 mb-1">Sign-out time</label>
                            <input type="time" value={editJobSignOutTime} onChange={e => setEditJobSignOutTime(e.target.value)} className={inp}/>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-600 mb-1">Checklists</label>
                            <div className="space-y-2 mt-1">
                              {checklistTemplates.map((t: any) => (
                                <label key={t.id} className="flex items-center gap-2 cursor-pointer">
                                  <input type="checkbox" checked={editJobTemplateIds?.includes(t.id) || false} onChange={e => setEditJobTemplateIds((prev: string[]) => e.target.checked ? [...(prev||[]), t.id] : (prev||[]).filter((id: string) => id !== t.id))} className="w-4 h-4 accent-teal-500"/>
                                  <span className="text-sm text-gray-700">{t.name}</span>
                                  {t.requires_approval && <span className="text-xs bg-teal-50 text-teal-600 px-1.5 py-0.5 rounded">Approval</span>}
                                  {t.audit_only && <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Audit</span>}
                                </label>
                              ))}
                            </div>
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
                          <div className="flex items-center justify-between mb-3">
                            <p className={"text-sm " + sub}>Click to assign or unassign</p>
                            <button onClick={async () => { setAssigningAll(true); await fetch("/api/admin/assign-all", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: j.id }) }); setAssigningAll(false); window.location.reload() }} disabled={assigningAll} className="text-xs bg-teal-50 text-teal-600 border border-teal-200 hover:bg-teal-100 rounded-lg px-3 py-1.5 font-medium disabled:opacity-50">{assigningAll ? "Assigning..." : "Assign all installers"}</button>
                          </div>
                          {installers.length === 0 ? <p className={"text-sm " + sub}>No installers yet</p>
                          : <div className="flex flex-wrap gap-2">
                            {installers.map((m: any) => {
                              const isAssigned = jobAssignments.some((a) => a.job_id === j.id && a.user_id === m.id)
                              return (
                                <button key={m.id} onClick={() => toggleAssignment(j.id, m.id)}
                                  className={"flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors " + (isAssigned ? "bg-teal-400 text-white" : "bg-white text-gray-700 border border-gray-200 hover:border-teal-300")}>
                                  <div className="w-6 h-6 rounded-full bg-black/10 flex items-center justify-center text-xs font-bold">{m.initials}</div>
                                  {m.name}{isAssigned && " ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã¢â‚¬Å“"}
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
                    <option value="installer">Installer - PIN app access only</option>
                    <option value="foreman">Foreman - PIN app + alert emails</option>
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
                          <button onClick={() => editingScheduleId === m.id ? setEditingScheduleId(null) : openSchedule(m)} className={"text-xs border rounded-lg px-3 py-1.5 transition-colors " + (editingScheduleId === m.id ? "border-teal-400 text-teal-600 bg-teal-50" : "border-gray-200 text-gray-600 hover:border-teal-300 hover:text-teal-600")}>Schedule</button>
                        <button onClick={() => toggleActive(m.id, m.is_active !== false)} className={"text-xs border rounded-lg px-3 py-1.5 transition-colors " + (m.is_active === false ? "border-teal-200 text-teal-600 hover:bg-teal-50" : "border-gray-200 text-gray-600 hover:border-amber-300 hover:text-amber-600")}>{m.is_active === false ? "Reactivate" : "Suspend"}</button>
                        <button onClick={() => removeMember(m.id, m.auth_user_id)} className="text-xs border border-red-200 text-red-500 hover:bg-red-50 rounded-lg px-3 py-1.5 transition-colors">Remove</button>
                      </div>
                    )}
                  </div>
                    {editingScheduleId === m.id && (
                      <MemberSchedule
                        member={m}
                        onSave={async (schedule) => {
                          await fetch("/api/admin/team/schedule", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ userId: m.id, weekly_schedule: schedule })
                          })
                          setEditingScheduleId(null)
                          router.refresh()
                        }}
                        onCancel={() => setEditingScheduleId(null)}
                      />
                    )}
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
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">Frequency</label>
                  <select value={templateFrequency} onChange={e => setTemplateFrequency(e.target.value)} className={inp}>
                    <option value="job">Per job (QA)</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="completion">Job completion</option>
                  </select>
                </div>
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
                    <span className="ml-2 text-xs bg-teal-50 text-teal-600 px-2 py-0.5 rounded-full">{t.frequency === "job" || !t.frequency ? "Per job" : t.frequency.charAt(0).toUpperCase() + t.frequency.slice(1)}</span>
                    <span className={"text-sm " + sub + " ml-3"}>{t.checklist_items?.length || 0} items</span>
                  </div>
                  <div className="flex gap-2 flex-wrap items-center">
                    <label className="flex items-center gap-1.5 cursor-pointer text-xs text-gray-600">
                      <input type="checkbox" checked={t.requires_approval || false} onChange={async e => { await fetch("/api/checklist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update_template", templateId: t.id, requires_approval: e.target.checked, audit_only: t.audit_only || false }) }); window.location.reload() }} className="w-3.5 h-3.5 accent-teal-500"/>
                      Requires approval
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer text-xs text-gray-600">
                      <input type="checkbox" checked={t.audit_only || false} onChange={async e => { await fetch("/api/checklist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update_template", templateId: t.id, requires_approval: t.requires_approval || false, audit_only: e.target.checked }) }); window.location.reload() }} className="w-3.5 h-3.5 accent-teal-500"/>
                      Audit only
                    </label>
                    <button onClick={() => { setShowAddItem(t.id); setFormError("") }} className="text-sm bg-teal-50 text-teal-600 hover:bg-teal-100 border border-teal-200 rounded-xl px-3 py-1.5 font-medium">+ Add item</button>
                    <button onClick={() => { setEditingTemplateId(t.id); setEditTemplateName(t.name); setEditTemplateFrequency(t.frequency || "job") }} className="text-sm bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-200 rounded-xl px-3 py-1.5 font-medium">Edit</button>
                    <button onClick={() => deleteTemplate(t.id)} className="text-sm bg-red-50 text-red-500 hover:bg-red-100 border border-red-200 rounded-xl px-3 py-1.5 font-medium">Delete</button>
                    {editingTemplateId === t.id && (<div className="w-full mt-3 p-3 bg-gray-50 rounded-xl border border-gray-200 flex flex-wrap gap-3 items-end"><div className="flex-1 min-w-[160px]"><label className="block text-xs font-medium text-gray-600 mb-1">Name</label><input value={editTemplateName} onChange={e => setEditTemplateName(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm" /></div><div><label className="block text-xs font-medium text-gray-600 mb-1">Frequency</label><select value={editTemplateFrequency} onChange={e => setEditTemplateFrequency(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm"><option value="job">Per job (QA)</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></div><button onClick={() => saveEditTemplate(t.id)} className="text-sm bg-teal-500 text-white rounded-xl px-4 py-1.5 font-medium">Save</button><button onClick={() => setEditingTemplateId(null)} className="text-sm text-gray-500 px-3 py-1.5">Cancel</button></div>)}
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
            <div className={cardHeader + " flex-col items-stretch gap-3"}>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <span className="font-semibold">Site diary - all jobs</span>
                <div className="flex items-center gap-3">
                  <span className={"text-sm " + sub}>{diaryEntries.length} entries</span>
                  <button onClick={() => router.refresh()} className={"text-xs border border-gray-200 rounded-lg px-3 py-1.5 " + sub + " hover:text-gray-900"}>Refresh</button>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  value={diarySearch}
                  onChange={e => setDiarySearch(e.target.value)}
                  placeholder="Search installer, job, or note..."
                  className="flex-1 min-w-[200px] bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-teal-400"
                />
                {(['all','blocker','issue','photos','videos','24h'] as const).map(f => {
                  const label = f === 'all' ? 'All' : f === 'blocker' ? 'Blockers' : f === 'issue' ? 'Issues' : f === 'photos' ? 'With photos' : f === 'videos' ? 'With videos' : 'Last 24h'
                  return (
                    <button
                      key={f}
                      onClick={() => setDiaryFilter(f)}
                      className={"text-xs px-3 py-1.5 rounded-full border " + (diaryFilter === f ? "bg-teal-500 text-white border-teal-500 font-semibold" : "bg-white text-gray-600 border-gray-200 hover:border-gray-300")}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>
            {(() => {
              const now = Date.now()
              const q = diarySearch.trim().toLowerCase()
              const filtered = diaryEntries.filter((d: any) => {
                if (diaryFilter === 'blocker' && d.ai_alert_type !== 'blocker') return false
                if (diaryFilter === 'issue' && d.ai_alert_type !== 'issue') return false
                if (diaryFilter === 'photos' && (!d.photo_urls || d.photo_urls.length === 0)) return false
                if (diaryFilter === 'videos' && !d.video_url) return false
                if (diaryFilter === '24h' && new Date(d.created_at).getTime() < now - 86400000) return false
                if (q) {
                  const hay = [
                    d.users?.name || '',
                    d.jobs?.name || '',
                    d.entry_text || '',
                    d.ai_summary || '',
                  ].join(' ').toLowerCase()
                  if (!hay.includes(q)) return false
                }
                return true
              })
              if (diaryEntries.length === 0) {
                return <div className={"px-6 py-16 text-center " + sub}>No diary entries yet</div>
              }
              if (filtered.length === 0) {
                return <div className={"px-6 py-16 text-center " + sub}>No entries match this filter</div>
              }
              return filtered.map((d: any) => {
                const hasText = d.entry_text && d.entry_text.trim().length > 0
                const hasPhotos = d.photo_urls && d.photo_urls.length > 0
                const hasVideo = !!d.video_url
                return (
                  <div key={d.id} className={"px-6 py-5 border-b border-gray-50 last:border-0" + (d.ai_alert_type === 'blocker' ? ' border-l-4 border-l-red-400' : d.ai_alert_type === 'issue' ? ' border-l-4 border-l-amber-400' : '')}>
                    <div className="flex items-start gap-4">
                      <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-sm font-bold flex-shrink-0">{d.users?.initials || "?"}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="font-semibold text-sm">{d.users?.name || "Unknown"}</span>
                          <span className="text-xs font-medium text-gray-700">{d.jobs?.name || "Unknown job"}</span>
                          <span className={"text-xs " + sub}>{new Date(d.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                          {d.ai_alert_type === 'blocker' && <span className="text-xs bg-red-50 text-red-600 border border-red-200 px-2 py-0.5 rounded-full font-bold">BLOCKER</span>}
                          {d.ai_alert_type === 'issue' && <span className="text-xs bg-amber-50 text-amber-600 border border-amber-200 px-2 py-0.5 rounded-full font-semibold">ISSUE</span>}
                        </div>
                        {hasText ? (
                          <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">{d.entry_text}</p>
                        ) : (
                          <p className="text-sm text-gray-400 italic">(no notes)</p>
                        )}
                        {d.ai_summary && d.ai_summary !== d.entry_text && (
                          <p className="text-xs text-gray-500 italic mt-1">{d.ai_summary}</p>
                        )}
                        {hasPhotos && (
                          <div className="flex gap-2 mt-2 flex-wrap">
                            {d.photo_urls.map((url: string, i: number) => (
                              <button key={i} onClick={() => setLightboxUrl(url)} className="focus:outline-none relative">
                                <img
                                  src={url}
                                  className="w-16 h-16 object-cover rounded-lg border border-gray-200 hover:border-teal-400 transition-colors"
                                  alt=""
                                  onError={(e) => {
                                    const img = e.currentTarget
                                    img.style.display = 'none'
                                    const ph = img.nextElementSibling as HTMLElement | null
                                    if (ph) ph.style.display = 'flex'
                                  }}
                                />
                                <span style={{display:'none'}} className="w-16 h-16 rounded-lg border border-dashed border-gray-300 bg-gray-50 text-[10px] text-gray-400 items-center justify-center text-center px-1">Photo unavailable</span>
                              </button>
                            ))}
                          </div>
                        )}
                        {hasVideo && (
                          <div className="mt-2">
                            <iframe src={d.video_url} className="w-full max-w-sm aspect-video rounded-lg border border-gray-200" allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture" allowFullScreen />
                          </div>
                        )}
                        {d.reply && (
                          <div className="mt-3 bg-teal-50 border border-teal-100 rounded-lg px-3 py-2">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs bg-teal-500 text-white px-2 py-0.5 rounded-full font-semibold">Replied</span>
                              {d.replied_at && <span className="text-xs text-teal-700">{new Date(d.replied_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>}
                            </div>
                            <p className="text-sm text-teal-900">{d.reply}</p>
                          </div>
                        )}
                      </div>
                      {!d.reply && (
                        <button onClick={() => { setReplyingDiary(replyingDiary === d.id ? null : d.id); setDiaryReply("") }} className="text-xs border border-gray-200 text-gray-500 hover:border-teal-300 hover:text-teal-600 rounded-lg px-3 py-1.5 flex-shrink-0">Reply</button>
                      )}
                    </div>
                    {replyingDiary === d.id && (
                      <div className="mt-3 flex gap-2 ml-13">
                        <input value={diaryReply} onChange={e => setDiaryReply(e.target.value)} placeholder="Send a message to the installer..." className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-400" onKeyDown={e => e.key === "Enter" && replyToDiary(d.id, d.user_id)} />
                        <button onClick={() => replyToDiary(d.id, d.user_id)} disabled={replySending} className="bg-teal-400 hover:bg-teal-500 text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">{replySending ? "Sending..." : "Send"}</button>
                      </div>
                    )}
                  </div>
                )
              })
            })()}
          </div>
        )}

        {activeTab === "performance" && (<ComplianceTab companyId={userData.company_id} teamMembers={teamMembers} />)}
        {activeTab === "payroll" && <PayrollTab teamMembers={teamMembers} />}
        {activeTab === "audit" && <AuditTab jobs={jobs} />}
        {activeTab === "map" && <MapTab />}
          {activeTab === "defects" && <DefectsTab />}
        {activeTab === "settings" && <SettingsTab />}

        {activeTab === "alerts" && (
          <div className={card}>
            <div className={cardHeader + " flex items-center justify-between flex-wrap gap-3"}>
              <span className="font-semibold">Alerts</span>
              <div className="flex items-center gap-2 flex-wrap">
                {(['all','blocker','issue','24h'] as const).map(f => {
                  const filtered = liveAlerts.filter((a: any) => {
                    if (f === 'all') return true
                    if (f === 'blocker') return a.alert_type === 'blocker'
                    if (f === 'issue') return a.alert_type === 'issue'
                    if (f === '24h') return new Date(a.created_at).getTime() > Date.now() - 86400000
                    return true
                  })
                  const count = filtered.length
                  const label = f === 'all' ? 'All' : f === 'blocker' ? 'Blockers' : f === 'issue' ? 'Issues' : 'Last 24h'
                  return (
                    <button key={f} onClick={() => setAlertFilter(f)} className={"text-xs px-3 py-1.5 rounded-full border " + (alertFilter === f ? "bg-teal-500 text-white border-teal-500 font-semibold" : "bg-white text-gray-600 border-gray-200 hover:border-gray-300")}>
                      {label} {count > 0 && <span className="ml-1 opacity-80">({count})</span>}
                    </button>
                  )
                })}
              </div>
            </div>
            {(() => {
              const filtered = liveAlerts.filter((a: any) => {
                if (alertFilter === 'all') return true
                if (alertFilter === 'blocker') return a.alert_type === 'blocker'
                if (alertFilter === 'issue') return a.alert_type === 'issue'
                if (alertFilter === '24h') return new Date(a.created_at).getTime() > Date.now() - 86400000
                return true
              })
              if (filtered.length === 0) {
                return <div className={"px-6 py-16 text-center " + sub}>No alerts match this filter</div>
              }
              // Group by job
              const byJob: Record<string, any[]> = {}
              filtered.forEach((a: any) => {
                const jobName = a.jobs?.name || 'Unknown job'
                if (!byJob[jobName]) byJob[jobName] = []
                byJob[jobName].push(a)
              })
              // If more than 3 jobs, show grouped view; else flat list
              const jobNames = Object.keys(byJob)
              if (jobNames.length > 3) {
                return (
                  <div>
                    {jobNames.map((jobName) => {
                      const group = byJob[jobName]
                      const isExpanded = expandedJobGroups.has(jobName)
                      const blockerCount = group.filter(a => a.alert_type === 'blocker').length
                      const issueCount = group.filter(a => a.alert_type === 'issue').length
                      return (
                        <div key={jobName} className="border-b border-gray-50 last:border-0">
                          <button
                            onClick={() => {
                              const s = new Set(expandedJobGroups)
                              if (s.has(jobName)) s.delete(jobName); else s.add(jobName)
                              setExpandedJobGroups(s)
                            }}
                            className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 text-left"
                          >
                            <div className="flex items-center gap-3 flex-wrap">
                              <span className="text-gray-400 text-sm">{isExpanded ? 'v' : '>'}</span>
                              <span className="font-semibold text-gray-700">{jobName}</span>
                              {blockerCount > 0 && <span className="text-xs bg-red-50 text-red-600 border border-red-200 px-2 py-0.5 rounded-full font-bold">{blockerCount} BLOCKER{blockerCount > 1 ? 'S' : ''}</span>}
                              {issueCount > 0 && <span className="text-xs bg-amber-50 text-amber-600 border border-amber-200 px-2 py-0.5 rounded-full font-semibold">{issueCount} ISSUE{issueCount > 1 ? 'S' : ''}</span>}
                            </div>
                            <span className="text-xs text-gray-400">{group.length} alert{group.length > 1 ? 's' : ''}</span>
                          </button>
                          {isExpanded && group.map((a: any) => (
                            <div key={a.id} className={"px-6 py-4 bg-gray-50/50 border-t border-gray-100" + (a.alert_type === "blocker" ? " border-l-4 border-l-red-400" : a.alert_type === "issue" ? " border-l-4 border-l-amber-400" : "")}>
                              <div className="flex items-start justify-between gap-4">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                                    {a.alert_type === "blocker" && <span className="text-xs bg-red-50 text-red-600 border border-red-200 px-2 py-0.5 rounded-full font-bold">BLOCKER</span>}
                                    {a.alert_type === "issue" && <span className="text-xs bg-amber-50 text-amber-600 border border-amber-200 px-2 py-0.5 rounded-full font-semibold">ISSUE</span>}
                                    {a.users?.name && <span className="text-xs text-gray-500">logged by {a.users.name}</span>}
                                    <span className={"text-xs " + sub}>{new Date(a.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                                  </div>
                                  <div className="text-sm text-gray-700">{a.message}</div>
                                </div>
                                <button onClick={() => { setResolvingAlert(resolvingAlert === a.id ? null : a.id); setResolutionNote("") }} className="text-sm bg-teal-50 text-teal-600 border border-teal-200 hover:bg-teal-100 rounded-lg px-3 py-1.5 flex-shrink-0 font-medium">Resolve</button>
                              </div>
                              {resolvingAlert === a.id && (
                                <div className="mt-3 flex gap-2">
                                  <input value={resolutionNote} onChange={e => setResolutionNote(e.target.value)} placeholder="Enter resolution note..." className="flex-1 bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-400" onKeyDown={e => e.key === "Enter" && resolveAlert(a.id)} />
                                  <button onClick={() => resolveAlert(a.id)} disabled={saving} className="bg-teal-400 hover:bg-teal-500 text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">{saving ? "Sending..." : "Send & resolve"}</button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )
                    })}
                  </div>
                )
              }
              // Flat list view (3 or fewer jobs)
              return filtered.map((a: any) => (
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
              ))
            })()}
          </div>
        )}

          {activeTab === 'alerts' && resolvedAlerts && resolvedAlerts.length > 0 && (
            <div className={card + " mt-4"}>
              <button
                onClick={() => setShowResolved(!showResolved)}
                className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 text-left"
              >
                <span className="font-semibold text-gray-500">{showResolved ? 'v' : '>'} Resolved alerts ({resolvedAlerts.length})</span>
                <span className="text-xs text-gray-400">{showResolved ? 'Hide' : 'Show'}</span>
              </button>
              {showResolved && resolvedAlerts.map((a: any) => (
                <div key={a.id} className="px-6 py-4 border-b border-gray-50 last:border-0 opacity-70">
                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        {a.alert_type === "blocker" && <span className="text-xs bg-red-50 text-red-400 border border-red-100 px-2 py-0.5 rounded-full font-bold">BLOCKER</span>}
                        {a.alert_type === "issue" && <span className="text-xs bg-amber-50 text-amber-400 border border-amber-100 px-2 py-0.5 rounded-full">ISSUE</span>}
                        <span className="text-xs font-medium text-gray-500">{a.jobs?.name}</span>
                        <span className={"text-xs " + sub}>{a.users?.name}</span>
                        <span className={"text-xs " + sub}>{new Date(a.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                      <p className="text-sm text-gray-500">{a.message}</p>
                      {a.resolution_note && (
                        <div className="mt-2 bg-teal-50 border border-teal-100 rounded-lg px-3 py-2 text-xs text-teal-700">
                          <strong>Resolution:</strong> {a.resolution_note} <span className="text-gray-400 ml-2">{a.resolved_at ? new Date(a.resolved_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}</span>
                        </div>
                      )}
                    </div>
                    <span className="text-xs bg-green-50 text-green-600 border border-green-200 px-2 py-0.5 rounded-full flex-shrink-0">Resolved</span>
                  </div>
                </div>
              ))}
            </div>
          )}


        </div>
      </div>
    </div>

    {lightboxUrl && (
      <div onClick={() => setLightboxUrl(null)} className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-8 cursor-pointer">
        <img src={lightboxUrl} className="max-w-full max-h-full object-contain rounded-lg" alt="" />
        <button onClick={() => setLightboxUrl(null)} className="absolute top-4 right-4 text-white text-3xl font-bold hover:text-gray-300">x</button>
      </div>
    )}
    </div>
  )
}







