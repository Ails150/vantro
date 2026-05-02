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
import ScheduleTab from "@/components/admin/ScheduleTab"
import CalendarTab from "@/components/admin/CalendarTab" // calendar_tab_marker
import { useState, useEffect, useRef, useMemo } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import PaywallOverlay from '@/components/billing/PaywallOverlay' // paywall_wired_v2
import SitesTab from "./SitesTab"
import TradesTab from "./TradesTab"
import TradeMultiSelect from "./TradeMultiSelect"
import CsvImportModal from "./CsvImportModal"
import PayrollExportModal from "./PayrollExportModal"
import SettingsMenu from "./SettingsMenu"
import { analyzeAllJobs, jobsNeedingAttention, summarizeJobStaffing } from "@/lib/staffing"

interface Props {
  user: any; userData: any; company: any; jobs: any[]; signins: any[]; alerts: any[]
  pendingQA: any[]; teamMembers: any[]; jobAssignments: any[]
  checklistTemplates: any[]; diaryEntries: any[]; resolvedAlerts: any[]; defaultTab: string; trialExpiredAndUnpaid?: boolean
}

export default function AdminDashboard({ user, userData, company, jobs, signins, alerts, pendingQA, teamMembers, jobAssignments, checklistTemplates, diaryEntries, resolvedAlerts, defaultTab, trialExpiredAndUnpaid }: Props) {
  const [activeTab, setActiveTab] = useState(defaultTab)
  useEffect(() => {
    try {
      const stored = localStorage.getItem("vantro_tab")
      if (stored) setActiveTab(stored)
    } catch {}
  }, [])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [setupExpanded, setSetupExpanded] = useState(true)
  const [operationsExpanded, setOperationsExpanded] = useState(true)
  useEffect(() => {
    try {
      if (localStorage.getItem("vantro_setup_expanded") === "0") setSetupExpanded(false)
      if (localStorage.getItem("vantro_ops_expanded") === "0") setOperationsExpanded(false)
    } catch {}
  }, [])
  useEffect(() => { try { localStorage.setItem("vantro_setup_expanded", setupExpanded ? "1" : "0") } catch {} }, [setupExpanded])
  useEffect(() => { try { localStorage.setItem("vantro_ops_expanded", operationsExpanded ? "1" : "0") } catch {} }, [operationsExpanded])
  useEffect(() => {
    try {
      const stored = localStorage.getItem("vantro_sidebar_collapsed")
      if (stored === "1") setSidebarCollapsed(true)
      if (window.innerWidth < 768) setSidebarCollapsed(true)
    } catch {}
  }, [])
  useEffect(() => {
    try { localStorage.setItem("vantro_sidebar_collapsed", sidebarCollapsed ? "1" : "0") } catch {}
  }, [sidebarCollapsed])
  useEffect(() => {
    function onResize() { if (window.innerWidth < 768) setSidebarCollapsed(true) }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])
  function tabInitials(label: string): string {
    const parts = label.trim().split(/\s+/)
    if (parts.length === 1) return parts[0].slice(0, 2)
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  const [showAddJob, setShowAddJob] = useState(false)
  const [showPayrollExport, setShowPayrollExport] = useState(false)
  const [showJobsImport, setShowJobsImport] = useState(false)
  const [showAddMember, setShowAddMember] = useState(false)
  // csv_import_v1
  const [showCsvImport, setShowCsvImport] = useState(false)
  const [csvRows, setCsvRows] = useState<Array<{name:string; email:string; role:string}>>([])
  const [csvError, setCsvError] = useState<string>("")
  const [csvImporting, setCsvImporting] = useState(false)
  const [csvResults, setCsvResults] = useState<any>(null)
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
  // ---- multi-trade v1 state (added by patch_trades_1_foundation) ----
  // trades_foundation_patched
  const [multiTradeEnabled, setMultiTradeEnabled] = useState(false)
  const [companyTrades, setCompanyTrades] = useState<Array<{ trade_key: string; label: string; enabled: boolean }>>([])
  // Team tab filters
  const [teamSearch, setTeamSearch] = useState("")
  const [teamRoleFilter, setTeamRoleFilter] = useState<string>("all")
  const [teamTradeFilter, setTeamTradeFilter] = useState<string>("all")
  const [teamStatusFilter, setTeamStatusFilter] = useState<"all" | "active" | "inactive">("all")
  const [openMenuMemberId, setOpenMenuMemberId] = useState<string | null>(null)
  const [jobRequiredTrades, setJobRequiredTrades] = useState<string[]>([])
  const [editJobRequiredTrades, setEditJobRequiredTrades] = useState<string[]>([])
  const [memberTrades, setMemberTrades] = useState<string[]>([])
  const [itemTrade, setItemTrade] = useState<string>("")

  // Fetch multi-trade state once on mount
  useEffect(() => {
    let cancelled = false
    fetch("/api/admin/trades", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        setMultiTradeEnabled(!!data.multi_trade_enabled)
        setCompanyTrades(Array.isArray(data.trades) ? data.trades : [])
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])
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
  const [localReplies, setLocalReplies] = useState<Record<string, string>>({})
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

  // staffing analysis - memoized so it only recomputes when jobs/team/assignments change
  const staffingResults = useMemo(() => analyzeAllJobs(
    jobs.map((j: any) => ({
      id: j.id,
      name: j.name,
      required_trades: Array.isArray(j.required_trades) ? j.required_trades : [],
    })),
    teamMembers.map((m: any) => ({
      id: m.id,
      name: m.name,
      role: m.role,
      is_active: m.is_active,
      trades: Array.isArray(m.trades) ? m.trades : [],
    })),
    jobAssignments.map((a: any) => ({
      job_id: a.job_id,
      user_id: a.user_id,
    }))
  ), [jobs, teamMembers, jobAssignments])

  // alerts: operational issues only (exclude "unspecified" - those are setup tasks, not ops)
  const staffingAlerts = useMemo(
    () => jobsNeedingAttention(staffingResults).filter((r: any) => r.status !== "unspecified"),
    [staffingResults]
  )

  // lookup map for per-row badges
  const staffingByJobId = useMemo(() => {
    const m: Record<string, any> = {}
    for (const r of staffingResults) m[r.jobId] = r
    return m
  }, [staffingResults])

  // Filtered/searched team members for the Team tab
  const filteredTeamMembers = useMemo(() => {
    const q = teamSearch.trim().toLowerCase()
    return teamMembers.filter((m: any) => {
      // Search: name + email
      if (q) {
        const name = (m.name || "").toLowerCase()
        const email = (m.email || "").toLowerCase()
        if (!name.includes(q) && !email.includes(q)) return false
      }
      // Role
      if (teamRoleFilter !== "all" && m.role !== teamRoleFilter) return false
      // Status
      if (teamStatusFilter === "active" && m.is_active === false) return false
      if (teamStatusFilter === "inactive" && m.is_active !== false) return false
      // Trade
      if (teamTradeFilter !== "all") {
        const trades = Array.isArray(m.trades) ? m.trades : []
        if (!trades.includes(teamTradeFilter)) return false
      }
      return true
    })
  }, [teamMembers, teamSearch, teamRoleFilter, teamTradeFilter, teamStatusFilter])

  // Counts per role/trade/status for the filter chips
  const teamCounts = useMemo(() => {
    const byRole: Record<string, number> = { all: teamMembers.length, installer: 0, foreman: 0, admin: 0 }
    const byTrade: Record<string, number> = {}
    let active = 0, inactive = 0
    for (const m of teamMembers) {
      if (m.role && byRole[m.role] !== undefined) byRole[m.role]++
      if (m.is_active === false) inactive++
      else active++
      const trades = Array.isArray(m.trades) ? m.trades : []
      for (const t of trades) byTrade[t] = (byTrade[t] || 0) + 1
    }
    return { byRole, byTrade, active, inactive }
  }, [teamMembers])

  // ============================================================
  // Overview triage view: derived data
  // ============================================================
  const overviewData = useMemo(() => {
    const now = new Date()
    const startOfToday = new Date(now); startOfToday.setHours(0,0,0,0)
    const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - now.getDay()); startOfWeek.setHours(0,0,0,0)
    const startOfLastWeek = new Date(startOfWeek); startOfLastWeek.setDate(startOfLastWeek.getDate() - 7)

    // Resolved alert ids set for fast lookup
    const resolvedIds = new Set((resolvedAlerts || []).map((r: any) => r.alert_id || r.id))

    // ZONE 1: Action queue
    const unreadBlockerAlerts = (alerts || []).filter((a: any) => a.alert_type === "blocker" && !resolvedIds.has(a.id))
    const understaffedJobs = staffingAlerts // already filtered to non-unspecified ops issues
    const unspecifiedJobs = staffingResults.filter((r: any) => r.status === "unspecified")
    const oldestPendingQA = (pendingQA || []).reduce((oldest: any, q: any) => {
      if (!oldest) return q
      return new Date(q.created_at) < new Date(oldest.created_at) ? q : oldest
    }, null)
    const oldestQAAgeHours = oldestPendingQA
      ? Math.floor((now.getTime() - new Date(oldestPendingQA.created_at).getTime()) / (1000 * 60 * 60))
      : 0

    const actionItems = [
      pendingQA.length > 0 && {
        key: "qa",
        label: pendingQA.length === 1 ? "QA approval waiting" : `${pendingQA.length} QA approvals waiting`,
        sub: oldestQAAgeHours > 24 ? `Oldest ${Math.floor(oldestQAAgeHours/24)}d` : `Oldest ${oldestQAAgeHours}h`,
        tab: "approvals",
        severity: oldestQAAgeHours > 48 ? "high" : "medium",
      },
      unreadBlockerAlerts.length > 0 && {
        key: "blockers",
        label: unreadBlockerAlerts.length === 1 ? "Unread blocker alert" : `${unreadBlockerAlerts.length} unread blocker alerts`,
        sub: "",
        tab: "alerts",
        severity: "high",
      },
      understaffedJobs.length > 0 && {
        key: "staffing",
        label: understaffedJobs.length === 1 ? "Job needs staffing" : `${understaffedJobs.length} jobs need staffing`,
        sub: "",
        tab: "jobs",
        severity: "medium",
      },
      unspecifiedJobs.length > 0 && {
        key: "trades",
        label: unspecifiedJobs.length === 1 ? "Job has no trades set" : `${unspecifiedJobs.length} jobs have no trades set`,
        sub: "Setup task",
        tab: "jobs",
        severity: "low",
      },
    ].filter(Boolean) as any[]

    // ZONE 2: Live state
    const todaySignins = (signins || []).filter((s: any) => new Date(s.signed_in_at) >= startOfToday)
    const onSiteByJobId: Record<string, number> = {}
    for (const s of todaySignins) {
      if (!s.signed_out_at) {
        onSiteByJobId[s.job_id] = (onSiteByJobId[s.job_id] || 0) + 1
      }
    }
    const activeJobs = jobs.filter((j: any) => j.status === "active")
    const onSiteTiles = activeJobs.map((j: any) => {
      const onSiteCount = onSiteByJobId[j.id] || 0
      const assignedCount = jobAssignments.filter((a: any) => a.job_id === j.id).length
      return { jobId: j.id, jobName: j.name, onSiteCount, assignedCount }
    })

    // Today's hours signed (only completed signins)
    let todayHours = 0
    for (const s of todaySignins) {
      if (s.signed_in_at && s.signed_out_at) {
        const ms = new Date(s.signed_out_at).getTime() - new Date(s.signed_in_at).getTime()
        if (ms > 0) todayHours += ms / (1000 * 60 * 60)
      }
    }

    // Last 7 days sparkline (hours per day, oldest -> newest)
    const sparkline: number[] = []
    for (let i = 6; i >= 0; i--) {
      const dayStart = new Date(startOfToday); dayStart.setDate(dayStart.getDate() - i)
      const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1)
      let dayHours = 0
      for (const s of (signins || [])) {
        if (!s.signed_in_at || !s.signed_out_at) continue
        const t = new Date(s.signed_in_at)
        if (t >= dayStart && t < dayEnd) {
          const ms = new Date(s.signed_out_at).getTime() - t.getTime()
          if (ms > 0) dayHours += ms / (1000 * 60 * 60)
        }
      }
      sparkline.push(Math.round(dayHours))
    }

    // ZONE 3: Trajectory (this week vs last week)
    function hoursInRange(start: Date, end: Date): number {
      let h = 0
      for (const s of (signins || [])) {
        if (!s.signed_in_at || !s.signed_out_at) continue
        const t = new Date(s.signed_in_at)
        if (t >= start && t < end) {
          const ms = new Date(s.signed_out_at).getTime() - t.getTime()
          if (ms > 0) h += ms / (1000 * 60 * 60)
        }
      }
      return Math.round(h)
    }
    const hoursThisWeek = hoursInRange(startOfWeek, now)
    const hoursLastWeek = hoursInRange(startOfLastWeek, startOfWeek)

    // Jobs completed this week vs last week (uses updated_at if present, falls back to created_at)
    function jobsCompletedInRange(start: Date, end: Date): number {
      return jobs.filter((j: any) => {
        if (j.status !== "completed") return false
        const ts = j.updated_at || j.created_at
        if (!ts) return false
        const t = new Date(ts)
        return t >= start && t < end
      }).length
    }
    const jobsCompletedThisWeek = jobsCompletedInRange(startOfWeek, now)
    const jobsCompletedLastWeek = jobsCompletedInRange(startOfLastWeek, startOfWeek)

    return {
      actionItems,
      onSiteTiles,
      todayHours: Math.round(todayHours),
      sparkline,
      hoursThisWeek,
      hoursLastWeek,
      jobsCompletedThisWeek,
      jobsCompletedLastWeek,
    }
  }, [jobs, signins, alerts, resolvedAlerts, pendingQA, jobAssignments, staffingAlerts, staffingResults])

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
    try {
      const res = await fetch("/api/diary/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId, userId, message: diaryReply })
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert("Could not send reply: " + (err.error || "Unknown error"))
        setReplySending(false)
        return
      }
      setLocalReplies(prev => ({ ...prev, [entryId]: diaryReply.trim() }))
      setReplyingDiary(null)
      setDiaryReply("")
    } catch (e: any) {
      alert("Network error sending reply: " + (e?.message || ""))
    } finally {
      setReplySending(false)
    }
  }

  async function markAlertRead(id: string) { await supabase.from("alerts").update({ is_read: true }).eq("id", id); router.refresh() }

  async function addJob() {
    if (!jobName.trim()) { setFormError("Enter a job name"); return }
    if (!jobPlaceSelected) { setFormError("Select an address from the dropdown - do not just type it"); return }
    setSaving(true); setFormError("")
    const { data: newJobData, error } = await supabase.from("jobs").insert({ company_id: userData.company_id, name: jobName.trim(), address: jobAddress.trim(), status: "active", checklist_template_id: jobTemplateId || null, lat: jobLat, lng: jobLng, start_time: jobStartTime, sign_out_time: jobSignOutTime, required_trades: multiTradeEnabled ? jobRequiredTrades : null }).select("id").single()
    if (error) { setFormError(error.message); setSaving(false); return }
    if (jobTemplateIds.length > 0 && newJobData) { for (const tid of jobTemplateIds) { await fetch("/api/checklist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "assign_to_job", jobId: newJobData.id, templateId: tid }) }) } }
    if (jobAssignedMembers.length > 0) { const newJob = await supabase.from("jobs").select("id").eq("company_id", userData.company_id).order("created_at", { ascending: false }).limit(1).single(); if (newJob.data) { for (const uid of jobAssignedMembers) { await supabase.from("job_assignments").upsert({ job_id: newJob.data.id, user_id: uid, company_id: userData.company_id }, { onConflict: "job_id,user_id" }) } } }
    setJobName(""); setJobAddress(""); setJobTemplateId(""); setJobTemplateIds([]); setJobAssignedMembers([]); setJobPlaceSelected(false); setShowAddJob(false); setSaving(false); setJobStartTime("08:00"); setJobSignOutTime("17:00"); setJobRequiredTrades([])
    router.refresh()
  }

  async function updateJob(jobId: string) {
    if (!editJobName.trim()) { setFormError("Enter a job name"); return }
    if (!editJobPlaceSelected && !editJobLat) { setFormError("Select an address from the dropdown - do not just type it"); return }
    setSaving(true); setFormError("")
    const newStatus = editJobStatus || "active"
    const { error } = await supabase.from("jobs").update({ name: editJobName.trim(), address: editJobAddress.trim(), lat: editJobLat, lng: editJobLng, status: newStatus, start_time: editJobStartTime, sign_out_time: editJobSignOutTime, required_trades: multiTradeEnabled ? editJobRequiredTrades : null }).eq("id", jobId)
    if (newStatus === "completed" || newStatus === "cancelled") {
      await supabase.from("signins").update({ signed_out_at: new Date().toISOString() }).eq("job_id", jobId).is("signed_out_at", null)
    }
    if (error) { setFormError(error.message); setSaving(false); return }
    await supabase.from("job_checklists").delete().eq("job_id", jobId)
    if (editJobTemplateIds.length > 0) {
      await supabase.from("job_checklists").insert(editJobTemplateIds.map((tid: string) => ({ job_id: jobId, template_id: tid })))
    }
    setEditingJobId(null); setSaving(false); setEditJobRequiredTrades([])
    window.location.reload()
  }

  async function deleteJob(jobId: string, jobName: string) {
    if (!window.confirm("Delete job: " + jobName + "? This cannot be undone.")) return
    const res = await fetch("/api/jobs/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId }) })
    if (res.ok) { window.location.href = "/admin?tab=jobs" }
    else { const d = await res.json(); alert("Failed to delete: " + d.error) }
  }

  // csv_import_v1
  // csv_parser_fix_v1
  function parseCsvText(text: string): Array<{name:string; email:string; role:string}> {
    const CR = String.fromCharCode(13)
    const LF = String.fromCharCode(10)
    const cleaned = text.split(CR).join("")
    const lines = cleaned.split(LF).map((l) => l.trim()).filter((l) => l.length > 0)
    if (lines.length === 0) return []
    let startIdx = 0
    const first = lines[0].toLowerCase()
    if (first.indexOf("name") !== -1 && first.indexOf("email") !== -1) {
      startIdx = 1
    }
    const rows: Array<{name:string; email:string; role:string}> = []
    for (let i = startIdx; i < lines.length; i++) {
      const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""))
      if (cols.length < 2) continue
      const name = cols[0] || ""
      const email = cols[1] || ""
      const role = cols[2] || "installer"
      rows.push({ name, email, role })
    }
    return rows
  }
  async function handleCsvFile(file: File) {
    setCsvError("")
    setCsvResults(null)
    if (!file.name.toLowerCase().endsWith(".csv") && file.type !== "text/csv") {
      setCsvError("Please choose a .csv file")
      return
    }
    try {
      const text = await file.text()
      const rows = parseCsvText(text)
      if (rows.length === 0) {
        setCsvError("No rows found in file")
        return
      }
      if (rows.length > 200) {
        setCsvError("Max 200 rows per import. Split your file.")
        return
      }
      setCsvRows(rows)
    } catch (err: any) {
      setCsvError(err?.message || "Could not read file")
    }
  }
  async function bulkImport() {
    if (csvRows.length === 0) return
    setCsvImporting(true)
    setCsvResults(null)
    try {
      const res = await fetch("/api/admin/team/bulk-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: csvRows }),
      })
      const data = await res.json()
      if (!res.ok) {
        setCsvError(data.error || "Import failed")
        setCsvResults(data.results ? data : null)
        setCsvImporting(false)
        return
      }
      setCsvResults(data)
      // Send invites for created rows
      const created = (data.results || []).filter((r: any) => r.status === "created")
      for (const c of created) {
        try {
          await fetch("/api/invite", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: c.email, name: c.name, role: csvRows.find(r => r.email.toLowerCase() === c.email)?.role || "installer" }),
          })
        } catch {}
      }
      router.refresh()
    } catch (err: any) {
      setCsvError(err?.message || "Import failed")
    }
    setCsvImporting(false)
  }
  function downloadSampleCsv() {
    const NL = String.fromCharCode(10)
    const sample =
      "name,email,role" + NL +
      "Pete Walker,pete@example.com,installer" + NL +
      "Tom Burke,tom@example.com,foreman" + NL
    const blob = new Blob([sample], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "vantro-team-template.csv"
    a.click()
    URL.revokeObjectURL(url)
  }
  function resetCsvImport() {
    setShowCsvImport(false)
    setCsvRows([])
    setCsvError("")
    setCsvResults(null)
  }

  // billing_polish_v1
  async function handleOpenBillingPortal() {
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" })
      const data = await res.json()
      if (data?.url) {
        window.open(data.url, "_blank", "noopener,noreferrer")
        return
      }
      alert(data?.error || "Could not open billing portal. Please try again or contact support.")
    } catch (err) {
      alert("Could not open billing portal. Please try again or contact support.")
    }
  }

  async function addMember() {
    if (!memberName.trim() || !memberEmail.trim()) { setFormError("Enter name and email"); return }
    setSaving(true); setFormError("")
    // installer_limit_enforced_v1
    try {
      const { data: companyRow } = await supabase
        .from("companies")
        .select("installer_limit")
        .eq("id", userData.company_id)
        .single()
      const limit = companyRow?.installer_limit
      if (limit) {
        const { count: activeCount } = await supabase
          .from("users")
          .select("*", { count: "exact", head: true })
          .eq("company_id", userData.company_id)
          .in("role", ["installer", "foreman"])
          .eq("is_active", true)
        if (activeCount !== null && activeCount >= limit) {
          setFormError(`You've reached your plan limit of ${limit} installers. Upgrade your plan to add more, or remove an existing user first.`)
          setSaving(false)
          return
        }
      }
    } catch {}
    const initials = memberName.trim().split(" ").map((n: any) => n[0]).join("").toUpperCase().slice(0, 2)
    const { error } = await supabase.from("users").insert({ company_id: userData.company_id, name: memberName.trim(), email: memberEmail.trim(), initials, role: memberRole, is_active: true, trades: multiTradeEnabled ? memberTrades : null })
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
    setMemberName(""); setMemberEmail(""); setMemberRole("installer"); setShowAddMember(false); setSaving(false); setMemberTrades([])
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
    const res = await fetch("/api/checklist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "add_item", templateId, label: itemLabel.trim(), item_type: itemType, is_mandatory: itemMandatory, requires_photo: itemPhoto, requires_video: itemVideo, fail_note_required: itemFailNote, trade: multiTradeEnabled ? (itemTrade || null) : null }) })
    if (!res.ok) { const d = await res.json(); setFormError(d.error); setSaving(false); return }
    setItemLabel(""); setItemType("tick"); setItemMandatory(false); setItemPhoto(false); setItemVideo(false); setItemFailNote(false); setShowAddItem(null); setSaving(false); setItemTrade("")
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

  const setupTabs: Array<{ id: string; label: string; badge?: number }> = [
    { id: "team", label: "Team" },
    { id: "sites", label: "Sites" },
    { id: "trades", label: "Trades" },
    { id: "jobs", label: "Jobs" },
    { id: "checklists", label: "Checklist Templates" },
    { id: "schedule", label: "Scheduler" }, // schedule_link_added
    { id: "calendar", label: "Calendar" }, // calendar_sidebar_marker
    { id: "settings", label: "Settings" },
  ]

  const operationsTabs: Array<{ id: string; label: string; badge?: number }> = [
    { id: "overview", label: "Overview" },
    { id: "alerts", label: "Alerts", badge: alerts.length },
    { id: "approvals", label: "QA Reviews", badge: pendingQA.length },
    { id: "diary", label: "Diary" },
    { id: "defects", label: "Defects" },
    { id: "map", label: "Map" },
    { id: "analytics", label: "Analytics" },
    { id: "performance", label: "Performance" },
    { id: "payroll", label: "Payroll" },
    { id: "audit", label: "Audit" },
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
        <PaywallOverlay show={!!trialExpiredAndUnpaid} companyName={company?.name} currentPlan={company?.current_plan} />
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
          <SettingsMenu user={user} userData={userData} company={company} onSiteRulesClick={() => setActiveTab("settings")} />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 md:gap-4 px-4 md:px-8 py-4 md:py-6">
        {(() => {
          const now = Date.now()
          const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
          const sevenDaysAgo = now - 7 * 86400000
          const todayCount = liveAlerts.filter((a: any) => new Date(a.created_at).getTime() >= todayStart.getTime()).length
          const blockerOpenCount = liveAlerts.filter((a: any) => a.alert_type === "blocker").length
          const olderCount = liveAlerts.filter((a: any) => new Date(a.created_at).getTime() < sevenDaysAgo).length
          return [
            { label: "On Site Now", value: signins.length, color: "text-teal-500" },
            { label: "Active Jobs", value: jobs.filter((j: any) => j.status === "active").length, color: "text-gray-900" },
            { label: "Awaiting Approval", value: pendingQA.length, color: "text-amber-500" },
            { label: "Today's Alerts", value: todayCount, color: todayCount > 0 ? "text-red-500" : "text-gray-400", onClick: () => { setActiveTab("alerts"); setAlertFilter("24h" as any) } },
            { label: "Open Blockers", value: blockerOpenCount, color: blockerOpenCount > 0 ? "text-red-600" : "text-gray-400", onClick: () => { setActiveTab("alerts"); setAlertFilter("blocker" as any) } },
            { label: "Older than 7d", value: olderCount, color: olderCount > 0 ? "text-amber-600" : "text-gray-400", onClick: () => { setActiveTab("alerts") } },
          ]
        })().map((s: any) => (
          <div
            key={s.label}
            onClick={s.onClick}
            className={"bg-white border border-gray-200 rounded-2xl p-4 md:p-6 shadow-sm " + (s.onClick ? "cursor-pointer hover:border-gray-300 transition-colors" : "")}
          >
            <div className="text-gray-500 text-xs md:text-sm font-medium mb-1 md:mb-2">{s.label}</div>
            <div className={"text-3xl md:text-4xl font-bold " + s.color}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="flex">
        {/* Left Sidebar */}
        <div data-marker="sidebar-collapsible-v1" className={"bg-white border-r border-gray-200 min-h-screen transition-all duration-200 relative " + (sidebarCollapsed ? "w-16" : "w-64")}>
          <div className={"space-y-6 " + (sidebarCollapsed ? "px-2 pt-14" : "p-6 pt-14")}>
              <button
                data-marker="sidebar-toggle-btn"
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                className="absolute top-3 right-2 w-8 h-8 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 flex items-center justify-center text-gray-500 hover:text-gray-800 transition-colors z-20"
                aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                title={sidebarCollapsed ? "Expand" : "Collapse"}
              >
                <svg width="14" height="14" viewBox="0 0 20 20" fill="none" className={"transition-transform " + (sidebarCollapsed ? "rotate-180" : "")}>
                  <path d="M12 4l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            {/* Setup Section */}
            <div>
              {!sidebarCollapsed && (
                <button onClick={() => setSetupExpanded(!setupExpanded)} className="w-full flex items-center justify-between text-sm font-semibold text-gray-900 mb-3 hover:text-teal-600 transition-colors">
                  <span>Setup</span>
                  <svg width="12" height="12" viewBox="0 0 20 20" fill="none" className={"transition-transform " + (setupExpanded ? "rotate-90" : "")}>
                    <path d="M7 4l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              )}
              <nav className="space-y-1">
                {(sidebarCollapsed || setupExpanded) && setupTabs.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => switchTab(tab.id)}
                    className={`w-full text-left px-3 py-2 text-sm font-medium rounded-lg transition-colors flex items-center justify-between ${
                      activeTab === tab.id 
                        ? 'bg-teal-50 text-teal-700 border-l-4 border-teal-400' 
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                    }`}
                  >
                    <span title={sidebarCollapsed ? tab.label : undefined}>{sidebarCollapsed ? tabInitials(tab.label) : tab.label}</span>
                    {tab.badge ? <span className={sidebarCollapsed ? "absolute top-1 right-1 w-2 h-2 bg-teal-500 rounded-full" : "bg-teal-100 text-teal-700 text-xs font-bold px-2 py-0.5 rounded-full"}>{sidebarCollapsed ? "" : tab.badge}</span> : null}
                  </button>
                ))}
              </nav>
            </div>

            {/* Operations Section */}
            <div>
              {!sidebarCollapsed && (
                <button onClick={() => setOperationsExpanded(!operationsExpanded)} className="w-full flex items-center justify-between text-sm font-semibold text-gray-900 mb-3 hover:text-teal-600 transition-colors">
                  <span>Operations</span>
                  <svg width="12" height="12" viewBox="0 0 20 20" fill="none" className={"transition-transform " + (operationsExpanded ? "rotate-90" : "")}>
                    <path d="M7 4l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              )}
              <nav className="space-y-1">
                {(sidebarCollapsed || operationsExpanded) && operationsTabs.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => switchTab(tab.id)}
                    className={`w-full text-left px-3 py-2 text-sm font-medium rounded-lg transition-colors flex items-center justify-between ${
                      activeTab === tab.id 
                        ? 'bg-teal-50 text-teal-700 border-l-4 border-teal-400' 
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                    }`}
                  >
                    <span title={sidebarCollapsed ? tab.label : undefined}>{sidebarCollapsed ? tabInitials(tab.label) : tab.label}</span>
                    {tab.badge ? <span className={sidebarCollapsed ? "absolute top-1 right-1 w-2 h-2 bg-teal-500 rounded-full" : "bg-teal-100 text-teal-700 text-xs font-bold px-2 py-0.5 rounded-full"}>{sidebarCollapsed ? "" : tab.badge}</span> : null}
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
          <div className="space-y-5">
            {/* ZONE 1: Action queue */}
            {overviewData.actionItems.length === 0 ? (
              <div className="bg-teal-50 border border-teal-200 rounded-2xl p-5 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-teal-500 text-white flex items-center justify-center font-bold">✓</div>
                <div>
                  <div className="font-semibold text-teal-900">All clear</div>
                  <div className="text-sm text-teal-700">Nothing needs your attention right now.</div>
                </div>
              </div>
            ) : (
              <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
                <h3 className="font-semibold mb-3">Needs you today</h3>
                <ul className="space-y-2">
                  {overviewData.actionItems.map((item: any) => {
                    const sevCls = item.severity === "high" ? "border-red-200 bg-red-50" : item.severity === "medium" ? "border-amber-200 bg-amber-50" : "border-gray-200 bg-gray-50"
                    const dotCls = item.severity === "high" ? "bg-red-500" : item.severity === "medium" ? "bg-amber-500" : "bg-gray-400"
                    return (
                      <li key={item.key} className={"flex items-center justify-between gap-3 border rounded-xl px-4 py-3 " + sevCls}>
                        <div className="flex items-center gap-3 min-w-0">
                          <span className={"w-2 h-2 rounded-full flex-shrink-0 " + dotCls}></span>
                          <div className="min-w-0">
                            <div className="font-medium text-sm">{item.label}</div>
                            {item.sub && <div className="text-xs text-gray-600 mt-0.5">{item.sub}</div>}
                          </div>
                        </div>
                        <button
                          onClick={() => setActiveTab(item.tab)}
                          className="text-xs font-semibold text-teal-700 hover:text-teal-900 flex-shrink-0"
                        >
                          View →
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}

            {/* ZONE 2: Live state */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Left: On-site tiles */}
              <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold">On site now</h3>
                  <button onClick={() => setActiveTab("map")} className="text-xs font-semibold text-teal-700 hover:text-teal-900">View map →</button>
                </div>
                {overviewData.onSiteTiles.length === 0 ? (
                  <div className={"text-sm py-6 text-center " + sub}>No active jobs</div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {overviewData.onSiteTiles.slice(0, 8).map((tile: any) => {
                      const empty = tile.onSiteCount === 0
                      const full = tile.assignedCount > 0 && tile.onSiteCount >= tile.assignedCount
                      const cls = empty ? "bg-red-50 border-red-200" : full ? "bg-teal-50 border-teal-200" : "bg-amber-50 border-amber-200"
                      const numCls = empty ? "text-red-700" : full ? "text-teal-700" : "text-amber-700"
                      return (
                        <div key={tile.jobId} className={"border rounded-xl px-3 py-2.5 " + cls}>
                          <div className="text-xs font-medium truncate" title={tile.jobName}>{tile.jobName}</div>
                          <div className={"text-2xl font-bold mt-0.5 leading-none " + numCls}>{tile.onSiteCount}</div>
                          <div className="text-[10px] text-gray-500 mt-1">of {tile.assignedCount || 0} assigned</div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Right: Today's hours + sparkline */}
              <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
                <h3 className="font-semibold mb-3">Hours logged today</h3>
                <div className="text-3xl font-bold text-gray-900">{overviewData.todayHours}h</div>
                <div className="text-xs text-gray-500 mt-1 mb-4">From signed-out shifts only</div>
                <div className="flex items-end gap-1 h-12">
                  {overviewData.sparkline.map((v: number, idx: number) => {
                    const max = Math.max(...overviewData.sparkline, 1)
                    const pct = (v / max) * 100
                    const isToday = idx === overviewData.sparkline.length - 1
                    return (
                      <div key={idx} className="flex-1 flex flex-col items-center justify-end h-full" title={v + "h"}>
                        <div className={"w-full rounded-sm " + (isToday ? "bg-teal-500" : "bg-gray-300")} style={{ height: pct + "%" }}></div>
                      </div>
                    )
                  })}
                </div>
                <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                  <span>7d ago</span>
                  <span>today</span>
                </div>
              </div>
            </div>

            {/* ZONE 3: Week-over-week trajectory */}
            <div className="grid grid-cols-2 md:grid-cols-2 gap-5">
              {(() => {
                const tiles = [
                  { label: "Hours signed", current: overviewData.hoursThisWeek, previous: overviewData.hoursLastWeek, suffix: "h" },
                  { label: "Jobs completed", current: overviewData.jobsCompletedThisWeek, previous: overviewData.jobsCompletedLastWeek, suffix: "" },
                ]
                return tiles.map((t) => {
                  const delta = t.current - t.previous
                  const pct = t.previous > 0 ? Math.round((delta / t.previous) * 100) : 0
                  const arrow = delta > 0 ? "↗" : delta < 0 ? "↘" : "="
                  const deltaCls = delta > 0 ? "text-teal-600" : delta < 0 ? "text-red-600" : "text-gray-500"
                  return (
                    <div key={t.label} className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">{t.label}</div>
                      <div className="text-3xl font-bold mt-1">{t.current}{t.suffix}</div>
                      <div className={"text-sm mt-1 " + deltaCls}>
                        {arrow} {Math.abs(delta)}{t.suffix} vs last week{t.previous > 0 ? " (" + (delta >= 0 ? "+" : "") + pct + "%)" : ""}
                      </div>
                    </div>
                  )
                })
              })()}
            </div>
          </div>
        )}

        {activeTab === "analytics" && <AnalyticsTab companyId={userData.company_id} teamMembers={teamMembers} jobs={jobs} />}
        {activeTab === "approvals" && <ApprovalsTab key={Date.now().toString()} pendingQA={pendingQA} onRefresh={() => router.refresh()} />}

        {activeTab === "jobs" && (
          <div className="space-y-5">
            {staffingAlerts.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div>
                    <h3 className="font-semibold text-amber-900">Staffing alerts</h3>
                    <p className="text-sm text-amber-800 mt-0.5">{staffingAlerts.length} {staffingAlerts.length === 1 ? "job needs" : "jobs need"} attention</p>
                  </div>
                </div>
                <ul className="space-y-2">
                  {staffingAlerts.slice(0, 5).map((r: any) => (
                    <li key={r.jobId} className="flex items-center justify-between gap-3 bg-white border border-amber-100 rounded-xl px-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm truncate">{r.jobName}</div>
                        <div className="text-xs text-amber-700 mt-0.5">{summarizeJobStaffing(r)}</div>
                      </div>
                      <span className={"text-xs px-2 py-1 rounded-full font-semibold flex-shrink-0 " + (r.status === "missing" ? "bg-red-100 text-red-700" : r.status === "partial" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600")}>
                        {r.status}
                      </span>
                    </li>
                  ))}
                </ul>
                {staffingAlerts.length > 5 && (
                  <div className="text-xs text-amber-700 mt-2">+ {staffingAlerts.length - 5} more</div>
                )}
              </div>
            )}
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowJobsImport(true)} className="px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:border-teal-300">Import CSV</button>
              <button onClick={() => { setShowAddJob(true); setFormError("") }} className={btn}>+ Add job</button>
              <CsvImportModal
                open={showJobsImport}
                onClose={() => setShowJobsImport(false)}
                onSuccess={() => router.refresh()}
                title="Import jobs from CSV"
                endpoint="/api/admin/jobs/bulk-import"
                fields={[
                  { key: "name", label: "Name", required: true, example: "14 The Parade" },
                  { key: "address", label: "Address", required: true, example: "14 The Parade" },
                  { key: "postcode", label: "Postcode", example: "WD17 1AB" },
                  { key: "foreman_email", label: "Foreman email", example: "" },
                  { key: "gps_radius", label: "GPS radius (m)", example: "150" },
                  { key: "start_date", label: "Start date", example: "2026-05-01" },
                  { key: "end_date", label: "End date", example: "2026-05-15" },
                ]}
                templateFilename="vantro-jobs-template.csv"
                maxRows={200}
              />
            </div>
            {showAddJob && (
              <div className="bg-white border border-teal-200 rounded-2xl p-6 space-y-4 shadow-sm">
                <h3 className="font-semibold">New job</h3>
                <input value={jobName} onChange={e => setJobName(e.target.value)} placeholder="Job name" className={inp}/>
                <div className="relative">
                  <input ref={addAddressRef} value={jobAddress} onChange={e => { setJobAddress(e.target.value); setJobPlaceSelected(false) }} placeholder="Start typing address, then select from dropdown..." className={inp}/>
                  {jobAddress && (
                    <div className={"absolute right-3 top-3 text-xs font-semibold " + (jobPlaceSelected ? "text-teal-500" : "text-red-400")}>
                      {jobPlaceSelected ? "✓ GPS verified" : "✗ Select from dropdown"}
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
                    <p className="text-sm text-gray-400">No checklists yet — <button type="button" onClick={() => { setShowAddJob(false); setActiveTab("checklists") }} className="text-teal-600 underline">create a checklist first</button></p>
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
                {/* trades_jobs_patched: add-job */}
                {multiTradeEnabled && companyTrades.filter(t => t.enabled).length > 0 && (
                  <div className="pt-2">
                    <TradeMultiSelect
                      trades={companyTrades.filter(t => t.enabled)}
                      selected={jobRequiredTrades}
                      onChange={setJobRequiredTrades}
                      label="Trades required for this job"
                      helperText="Installers without these trades will see a warning when working on this job."
                    />
                  </div>
                )}
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
                      <button onClick={() => { setEditingJobId(editingJobId === j.id ? null : j.id); setEditJobName(j.name); setEditJobAddress(j.address); setEditJobTemplateId(j.checklist_template_id || ""); setEditJobTemplateIds((j.job_checklists||[]).map((jc:any) => jc.template_id)); fetch('/api/admin/jobs/checklists?jobId='+j.id).then(r=>r.json()).then((d:any)=>{ if(d.templateIds) setEditJobTemplateIds(d.templateIds) }); setEditJobPlaceSelected(true); setEditJobSignOutTime(j.sign_out_time ? j.sign_out_time.slice(0, 5) : "17:00"); setEditJobRequiredTrades(Array.isArray(j.required_trades) ? j.required_trades : []); setFormError("") }} className="text-sm border border-gray-200 text-gray-600 hover:border-teal-300 hover:text-teal-600 rounded-xl px-4 py-2 transition-colors flex-shrink-0">
                        {editingJobId === j.id ? "Cancel" : "Edit"}
                      </button>
                      <button onClick={() => setAssigningJobId(isAssigning ? null : j.id)} className="text-sm border border-gray-200 text-gray-600 hover:border-teal-300 hover:text-teal-600 rounded-xl px-4 py-2 transition-colors flex-shrink-0">
                        {isAssigning ? "Done" : "Assign"}
                      </button>
                      {(() => { const sr = staffingByJobId[j.id]; if (!sr || sr.status === "covered") return null; const cls = sr.status === "missing" ? "bg-red-50 text-red-700" : sr.status === "partial" ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-500"; return <span className={"text-xs px-2.5 py-1 rounded-full font-semibold flex-shrink-0 " + cls} title={summarizeJobStaffing(sr)}>{sr.status === "missing" ? "Understaffed" : sr.status === "partial" ? "Partial" : "Trades not set"}</span> })()}
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
                          {/* trades_jobs_patched: edit-job */}
                          {multiTradeEnabled && companyTrades.filter(t => t.enabled).length > 0 && (
                            <div>
                              <TradeMultiSelect
                                trades={companyTrades.filter(t => t.enabled)}
                                selected={editJobRequiredTrades}
                                onChange={setEditJobRequiredTrades}
                                label="Trades required"
                              />
                            </div>
                          )}
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
            {/* installer_limit_enforced_v1 banner */}
            {/* banner_data_source_fix_v1: read from company prop, not userData.companies */}

            {(() => {
              const limit = (company as any)?.installer_limit
              const active = teamMembers.filter((m: any) => ["installer","foreman"].includes(m.role) && m.is_active !== false).length
              if (limit && active > limit) {
                const over = active - limit
                return (
                  <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800 flex items-start justify-between gap-4">
                    <div>
                      <strong>You're {over} over your plan limit of {limit} installers.</strong> Existing users will keep working. To add more, upgrade your plan or remove a user.
                    </div>
                    <button
                      onClick={handleOpenBillingPortal}
                      className="flex-shrink-0 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors whitespace-nowrap"
                    >
                      Upgrade plan →
                    </button>
                  </div>
                )
              }
              return null
            })()}
            {/* csv_import_v1 */}
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowCsvImport(true)} className={btnGhost}>Import CSV</button>
              <button onClick={() => { setShowAddMember(true); setFormError("") }} className={btn}>+ Add member</button>
            </div>
            {showCsvImport && (
              <div className="bg-white border border-teal-200 rounded-2xl p-6 space-y-4 shadow-sm">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold">Import team from CSV</h3>
                    <p className="text-sm text-gray-500">Upload a CSV with columns: name, email, role. Existing emails are skipped.</p>
                  </div>
                  <button onClick={downloadSampleCsv} className="text-sm text-teal-600 hover:underline">Download template</button>
                </div>
                {!csvResults && csvRows.length === 0 && (
                  <div>
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleCsvFile(f) }}
                      className="block w-full text-sm border border-gray-200 rounded-md p-3"
                    />
                    {csvError && <p className="text-sm text-red-600 mt-2">{csvError}</p>}
                  </div>
                )}
                {!csvResults && csvRows.length > 0 && (
                  <div>
                    <p className="text-sm text-gray-600 mb-2">{csvRows.length} row(s) ready to import:</p>
                    <div className="border border-gray-200 rounded-md max-h-64 overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-xs text-gray-500">
                          <tr>
                            <th className="px-3 py-2 text-left">Name</th>
                            <th className="px-3 py-2 text-left">Email</th>
                            <th className="px-3 py-2 text-left">Role</th>
                          </tr>
                        </thead>
                        <tbody>
                          {csvRows.map((r, i) => (
                            <tr key={i} className="border-t border-gray-100">
                              <td className="px-3 py-2">{r.name}</td>
                              <td className="px-3 py-2">{r.email}</td>
                              <td className="px-3 py-2">{r.role}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {csvError && <p className="text-sm text-red-600 mt-2">{csvError}</p>}
                    <div className="flex gap-3 mt-4">
                      <button onClick={bulkImport} disabled={csvImporting} className={btn}>
                        {csvImporting ? "Importing..." : `Import ${csvRows.length} member(s)`}
                      </button>
                      <button onClick={() => setCsvRows([])} className={btnGhost}>Choose different file</button>
                      <button onClick={resetCsvImport} className={btnGhost}>Cancel</button>
                    </div>
                  </div>
                )}
                {csvResults && (
                  <div>
                    <div className="flex gap-4 mb-3 text-sm">
                      <span className="text-teal-600">Created: {csvResults.summary?.created || 0}</span>
                      <span className="text-gray-500">Skipped: {csvResults.summary?.skipped || 0}</span>
                      <span className="text-red-600">Errors: {csvResults.summary?.errored || 0}</span>
                    </div>
                    <div className="border border-gray-200 rounded-md max-h-64 overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-xs text-gray-500">
                          <tr>
                            <th className="px-3 py-2 text-left">Row</th>
                            <th className="px-3 py-2 text-left">Name</th>
                            <th className="px-3 py-2 text-left">Email</th>
                            <th className="px-3 py-2 text-left">Status</th>
                            <th className="px-3 py-2 text-left">Detail</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(csvResults.results || []).map((r: any, i: number) => (
                            <tr key={i} className="border-t border-gray-100">
                              <td className="px-3 py-2">{r.row}</td>
                              <td className="px-3 py-2">{r.name}</td>
                              <td className="px-3 py-2">{r.email}</td>
                              <td className={"px-3 py-2 " + (r.status === "created" ? "text-teal-600" : r.status === "skipped" ? "text-gray-500" : "text-red-600")}>{r.status}</td>
                              <td className="px-3 py-2 text-gray-500">{r.message || ""}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex gap-3 mt-4">
                      <button onClick={resetCsvImport} className={btn}>Done</button>
                    </div>
                  </div>
                )}
              </div>
            )}
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
                {/* trades_team_patched */}
                {multiTradeEnabled && companyTrades.filter(t => t.enabled).length > 0 && (
                  <div>
                    <TradeMultiSelect
                      trades={companyTrades.filter(t => t.enabled)}
                      selected={memberTrades}
                      onChange={setMemberTrades}
                      label="Trades this person is qualified for"
                      helperText="They will see a warning if assigned to a job that needs trades they don't have."
                    />
                  </div>
                )}
                {formError && <p className="text-sm text-red-500">{formError}</p>}
                <div className="flex gap-3">
                  <button onClick={addMember} disabled={saving} className={btn}>{saving ? "Saving..." : "Save and send invite"}</button>
                  <button onClick={() => setShowAddMember(false)} className={btnGhost}>Cancel</button>
                </div>
              </div>
            )}
            {/* Team filters */}
            <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <input
                  type="text"
                  value={teamSearch}
                  onChange={e => setTeamSearch(e.target.value)}
                  placeholder="Search by name or email..."
                  className="flex-1 min-w-[200px] max-w-md border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-teal-400"
                />
                {teamSearch && (
                  <button onClick={() => setTeamSearch("")} className="text-xs text-gray-500 hover:text-gray-700">Clear</button>
                )}
              </div>

              {/* Role chips */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-gray-500 mr-1">Role:</span>
                {(["all", "installer", "foreman", "admin"] as const).map(r => {
                  const count = teamCounts.byRole[r] || 0
                  const active = teamRoleFilter === r
                  return (
                    <button
                      key={r}
                      onClick={() => setTeamRoleFilter(r)}
                      className={"text-xs px-3 py-1 rounded-full font-medium transition-colors " + (active ? "bg-teal-500 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}
                    >
                      {r === "all" ? "All" : r.charAt(0).toUpperCase() + r.slice(1)} {count}
                    </button>
                  )
                })}
              </div>

              {/* Status chips */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-gray-500 mr-1">Status:</span>
                {(["all", "active", "inactive"] as const).map(s => {
                  const count = s === "all" ? teamMembers.length : s === "active" ? teamCounts.active : teamCounts.inactive
                  const active = teamStatusFilter === s
                  return (
                    <button
                      key={s}
                      onClick={() => setTeamStatusFilter(s)}
                      className={"text-xs px-3 py-1 rounded-full font-medium transition-colors " + (active ? "bg-teal-500 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}
                    >
                      {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)} {count}
                    </button>
                  )
                })}
              </div>

              {/* Trade chips - only show when multi-trade enabled and trades exist */}
              {multiTradeEnabled && companyTrades.filter(t => t.enabled).length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-gray-500 mr-1">Trade:</span>
                  <button
                    onClick={() => setTeamTradeFilter("all")}
                    className={"text-xs px-3 py-1 rounded-full font-medium transition-colors " + (teamTradeFilter === "all" ? "bg-teal-500 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}
                  >
                    All {teamMembers.length}
                  </button>
                  {companyTrades.filter(t => t.enabled).map(t => {
                    const count = teamCounts.byTrade[t.trade_key] || 0
                    const active = teamTradeFilter === t.trade_key
                    return (
                      <button
                        key={t.trade_key}
                        onClick={() => setTeamTradeFilter(t.trade_key)}
                        className={"text-xs px-3 py-1 rounded-full font-medium transition-colors " + (active ? "bg-teal-500 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}
                      >
                        {t.label} {count}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <div className={card}>
              <div className={cardHeader}>
                <span className="font-semibold">Team members</span>
                <span className="text-xs text-gray-500 ml-2">{filteredTeamMembers.length} of {teamMembers.length}</span>
              </div>
              {filteredTeamMembers.length === 0 ? <div className={"px-6 py-16 text-center " + sub}>{teamMembers.length === 0 ? "No team members yet" : "No matches"}</div>
              : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
                    {filteredTeamMembers.map((m: any) => {
                      const isActive = m.is_active !== false
                      const isInstFm = m.role === "installer" || m.role === "foreman"
                      const memberTrades = Array.isArray(m.trades) ? m.trades : []
                      const tradeLabels = memberTrades.map((tk: string) => {
                        const t = companyTrades.find((ct: any) => ct.trade_key === tk)
                        return t ? t.label : tk
                      })
                      const menuOpen = openMenuMemberId === m.id
                      const roleBadgeCls = roleColors[m.role] || "bg-gray-100 text-gray-600"
                      return (
                        <div
                          key={m.id}
                          className={"relative border rounded-2xl p-4 transition-colors flex flex-col min-h-[180px] " + (!isActive ? "bg-gray-50 border-gray-200 opacity-75" : (!m.pin_hash && m.role === "installer") ? "bg-red-50 border-red-200 hover:border-red-300" : "bg-white border-gray-200 hover:border-teal-300")}
                        >
                          <div className="flex items-start gap-3 mb-3">
                            <div className={"w-10 h-10 rounded-full flex items-center justify-center font-bold flex-shrink-0 " + (isActive ? "bg-gray-100 text-gray-900" : "bg-gray-100 text-gray-400")}>
                              {m.initials}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className={"font-semibold text-sm truncate " + (isActive ? "" : "text-gray-400")} title={m.name}>{m.name}</div>
                              <div className="text-xs text-gray-500 truncate" title={m.email}>{m.email || "No email"}</div>
                            </div>
                            <span className={"text-[10px] px-2 py-0.5 rounded-full capitalize font-medium flex-shrink-0 " + roleBadgeCls}>{m.role}</span>
                          </div>

                          {(!isActive || (!m.pin_hash && m.role === "installer")) && (
                            <div className="flex flex-wrap gap-1.5 mb-3">
                              {!isActive && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-medium">Suspended</span>}
                              {!m.pin_hash && m.role === "installer" && <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-50 text-red-700 font-medium">PIN not set</span>}
                            </div>
                          )}

                          {multiTradeEnabled && (m.role === "installer" || m.role === "foreman") && (
                            <div className="flex flex-wrap gap-1 mb-3">
                              {tradeLabels.length > 0 ? (
                                tradeLabels.map((label: string, idx: number) => (
                                  <span key={idx} className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium">{label}</span>
                                ))
                              ) : (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-dashed border-gray-300">No trades set</span>
                              )}
                            </div>
                          )}

                          {isInstFm && (
                            <div className="flex items-center gap-2 pt-3 mt-auto border-t border-gray-100">
                              <button
                                onClick={() => editingScheduleId === m.id ? setEditingScheduleId(null) : openSchedule(m)}
                                className={"flex-1 text-xs rounded-lg px-3 py-1.5 transition-colors " + (editingScheduleId === m.id ? "border border-teal-400 text-teal-600 bg-teal-50" : "border border-gray-200 text-gray-600 hover:border-teal-300 hover:text-teal-600")}
                              >
                                {editingScheduleId === m.id ? "Close" : "Schedule"}
                              </button>
                              <div className="relative">
                                <button
                                  onClick={() => setOpenMenuMemberId(menuOpen ? null : m.id)}
                                  className="text-xs border border-gray-200 text-gray-600 hover:border-gray-300 rounded-lg px-2.5 py-1.5 transition-colors"
                                  aria-label="More actions"
                                >
                                  ...
                                </button>
                                {menuOpen && (
                                  <>
                                    <div
                                      className="fixed inset-0 z-10"
                                      onClick={() => setOpenMenuMemberId(null)}
                                    />
                                    <div className="absolute right-0 bottom-full mb-1 z-20 bg-white border border-gray-200 rounded-xl shadow-lg py-1 w-44">
                                      <button onClick={() => { resendInvite(m.email, m.name); setOpenMenuMemberId(null) }} className="w-full text-left text-xs px-3 py-2 hover:bg-gray-50">Resend invite</button>
                                      <button onClick={() => { resetPin(m.id); setOpenMenuMemberId(null) }} className="w-full text-left text-xs px-3 py-2 hover:bg-gray-50">Reset PIN</button>
                                      <button onClick={() => { toggleActive(m.id, isActive); setOpenMenuMemberId(null) }} className={"w-full text-left text-xs px-3 py-2 hover:bg-gray-50 " + (isActive ? "text-amber-600" : "text-teal-600")}>{isActive ? "Suspend" : "Reactivate"}</button>
                                      <div className="border-t border-gray-100 my-1"></div>
                                      <button onClick={() => { removeMember(m.id, m.auth_user_id); setOpenMenuMemberId(null) }} className="w-full text-left text-xs px-3 py-2 text-red-600 hover:bg-red-50">Remove</button>
                                    </div>
                                  </>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {editingScheduleId && filteredTeamMembers.find((m: any) => m.id === editingScheduleId) && (() => {
                    const m = filteredTeamMembers.find((mm: any) => mm.id === editingScheduleId)
                    return (
                      <div className="border-t border-gray-100 px-4 py-4">
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
                      </div>
                    )
                  })()}
                </>
              )}
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
                    {/* trades_checklist_patched */}
                    {multiTradeEnabled && companyTrades.filter(t => t.enabled).length > 0 && (
                      <div>
                        <label className="block text-sm font-medium text-gray-600 mb-1">Trade (optional)</label>
                        <select value={itemTrade} onChange={e => setItemTrade(e.target.value)} className={inp}>
                          <option value="">All trades</option>
                          {companyTrades.filter(t => t.enabled).map(t => (
                            <option key={t.trade_key} value={t.trade_key}>{t.label}</option>
                          ))}
                        </select>
                        <p className="text-xs text-gray-500 mt-1">Leave as "All trades" to show this item to every installer.</p>
                      </div>
                    )}
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
                        {item.trade && <span className="text-xs bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full font-medium">{companyTrades.find(t => t.trade_key === item.trade)?.label || item.trade}</span>}
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
                        {(d.reply || localReplies[d.id]) && (
                          <div className="mt-3 bg-teal-50 border border-teal-100 rounded-lg px-3 py-2">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs bg-teal-500 text-white px-2 py-0.5 rounded-full font-semibold">Replied</span>
                              {d.replied_at && <span className="text-xs text-teal-700">{new Date(d.replied_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>}
                            </div>
                            <p className="text-sm text-teal-900">{d.reply || localReplies[d.id]}</p>
                          </div>
                        )}
                      </div>
                      {!(d.reply || localReplies[d.id]) && (
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
        {activeTab === "payroll" && (
          <div>
            <div className="flex justify-end mb-4">
              <button onClick={() => setShowPayrollExport(true)} className="px-4 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-xl text-sm font-semibold">Export to CSV</button>
            </div>
            <PayrollTab teamMembers={teamMembers} />
            <PayrollExportModal open={showPayrollExport} onClose={() => setShowPayrollExport(false)} />
          </div>
        )}
        {activeTab === "sites" && <SitesTab />}
        {activeTab === "trades" && <TradesTab />}
        {activeTab === "audit" && <AuditTab jobs={jobs} aiAuditEnabled={!!company?.ai_audit_enabled} />}
        {activeTab === "map" && <MapTab />}
          {activeTab === "defects" && <DefectsTab />}
        {activeTab === "schedule" && <ScheduleTab />}
        {activeTab === "calendar" && <CalendarTab />}
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







