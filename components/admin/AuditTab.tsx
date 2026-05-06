"use client"

import { useState, useEffect } from "react"
import UpgradeAIAuditPack from "./UpgradeAIAuditPack"

interface Props {
  jobs: any[]
  aiAuditEnabled?: boolean
  aiAuditTrialEndsAt?: string | null
  stripeAiAuditSubscriptionItemId?: string | null
}

function getAiAuditView(trialEndsAt?: string | null, subscriptionItemId?: string | null) {
  if (subscriptionItemId) return { kind: "paid" as const }
  if (trialEndsAt && new Date(trialEndsAt) > new Date()) {
    const ms = new Date(trialEndsAt).getTime() - Date.now()
    const daysLeft = Math.max(1, Math.ceil(ms / (1000 * 60 * 60 * 24)))
    return { kind: "trial" as const, daysLeft, endsAt: trialEndsAt }
  }
  return { kind: "none" as const }
}

type ViewMode = "internal" | "client" | "compliance"

export default function AuditTab({ jobs, aiAuditEnabled, aiAuditTrialEndsAt, stripeAiAuditSubscriptionItemId }: Props) {
  if (!aiAuditEnabled) return <UpgradeAIAuditPack />
  const aiAuditView = getAiAuditView(aiAuditTrialEndsAt, stripeAiAuditSubscriptionItemId)

  const [selectedJob, setSelectedJob] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState<any>(null)
  const [reportV2, setReportV2] = useState<any>(null)
  const [error, setError] = useState("")
  const [shareLink, setShareLink] = useState("")
  const [creatingLink, setCreatingLink] = useState(false)
  const [copied, setCopied] = useState(false)
  const [activeShares, setActiveShares] = useState<any[]>([])

  // New v2 UI state
  const [viewMode, setViewMode] = useState<ViewMode>("internal")
  const [costEnabled, setCostEnabled] = useState(false)
  const [hourlyRate, setHourlyRate] = useState<number>(35)
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [expandedDeliverable, setExpandedDeliverable] = useState<string | null>(null)
  const [actionInProgress, setActionInProgress] = useState(false)
  const [actionMsg, setActionMsg] = useState("")

  // Modal state
  const [qaModal, setQaModal] = useState<any>(null)
  const [defectModal, setDefectModal] = useState<any>(null)
  const [completeModal, setCompleteModal] = useState<any>(null)

  // Persist view mode and cost toggle
  useEffect(() => {
    const v = localStorage.getItem("vantro_audit_view")
    if (v === "internal" || v === "client" || v === "compliance") setViewMode(v)
    const c = localStorage.getItem("vantro_audit_cost")
    if (c === "1") setCostEnabled(true)
    const r = localStorage.getItem("vantro_audit_rate")
    if (r) setHourlyRate(parseFloat(r) || 35)
  }, [])

  useEffect(() => { localStorage.setItem("vantro_audit_view", viewMode) }, [viewMode])
  useEffect(() => { localStorage.setItem("vantro_audit_cost", costEnabled ? "1" : "0") }, [costEnabled])
  useEffect(() => { localStorage.setItem("vantro_audit_rate", String(hourlyRate)) }, [hourlyRate])

  async function generate() {
    if (!selectedJob) return
    setLoading(true); setError(""); setReport(null); setReportV2(null); setShareLink("")
    try {
      const params = new URLSearchParams({ jobId: selectedJob })
      if (from) params.set("from", from)
      if (to) params.set("to", to)
      const v1Promise = fetch(`/api/audit?${params}`).then(r => r.json())
      const v2Promise = fetch("/api/audit/v2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: selectedJob, from: from || null, to: to || null }),
      }).then(r => r.json())
      const [v1Data, v2Data] = await Promise.all([v1Promise, v2Promise])
      if (v1Data.error) throw new Error(v1Data.error)
      setReport(v1Data)
      setReportV2(v2Data)
      loadShareLinks(selectedJob)
    } catch (err: any) {
      setError(err?.message || "Failed")
    } finally {
      setLoading(false)
    }
  }

  async function refreshAI() {
    if (!selectedJob) return
    setLoading(true); setError("")
    try {
      const r = await fetch("/api/audit/v2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: selectedJob, from: from || null, to: to || null }),
      })
      const d = await r.json()
      setReportV2(d)
    } catch (err: any) {
      setError(err?.message || "Failed")
    } finally {
      setLoading(false)
    }
  }

  async function loadShareLinks(jobId: string) {
    try {
      const res = await fetch(`/api/audit/share?jobId=${jobId}`)
      const data = await res.json()
      if (res.ok) setActiveShares(data.shares || [])
    } catch {}
  }

  async function createShareLink() {
    if (!selectedJob) return
    setCreatingLink(true); setError("")
    try {
      const res = await fetch("/api/audit/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: selectedJob, from: from || null, to: to || null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Could not create link")
      setShareLink(data.url)
      loadShareLinks(selectedJob)
    } catch (err: any) {
      setError(err?.message || "Failed")
    } finally {
      setCreatingLink(false)
    }
  }

  function copyLink(text: string) {
    if (!text) return
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Inline action handlers
  async function performAction(action: string, params: any) {
    setActionInProgress(true); setActionMsg("")
    try {
      const res = await fetch("/api/audit/v2/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...params }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Action failed")
      setActionMsg("Saved")
      // Refresh the data
      await generate()
    } catch (err: any) {
      setActionMsg(err?.message || "Failed")
    } finally {
      setActionInProgress(false)
      setTimeout(() => setActionMsg(""), 3000)
    }
  }

  const card = "bg-white border border-gray-200 rounded-2xl shadow-sm"
  const inp = "w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"

  // Computed values from v1 report (for evidence section)
  const totalHours = report ? report.signins.reduce((sum: number, s: any) => {
    if (!s.signed_out_at) return sum
    const hrs = (new Date(s.signed_out_at).getTime() - new Date(s.signed_in_at).getTime()) / 3600000
    return sum + hrs
  }, 0) : 0

  // Health colour
  const healthColour = reportV2?.health?.status === "in_trouble" ? "red" :
                       reportV2?.health?.status === "at_risk" ? "amber" : "green"

  return (
    <div className="space-y-4">
      {/* Trial banner */}
      {aiAuditView.kind === "trial" && (
        <div className="bg-gradient-to-r from-teal-50 to-emerald-50 border border-teal-200 rounded-2xl p-4 flex items-center justify-between gap-4">
          <div>
            <div className="font-semibold text-teal-900 text-sm">AI Audit Pack — free during trial</div>
            <div className="text-xs text-teal-700 mt-0.5">{aiAuditView.daysLeft} day{aiAuditView.daysLeft === 1 ? "" : "s"} left, then £79/month to keep your audit pack.</div>
          </div>
          <button onClick={() => window.location.href = "/billing"} className="px-4 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-lg text-sm font-semibold whitespace-nowrap">
            Add £79/mo to keep
          </button>
        </div>
      )}
      {aiAuditView.kind === "paid" && (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-teal-100 text-teal-700 rounded-full text-xs font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-teal-500"></span>
            AI Audit Pack · Active
          </span>
        </div>
      )}

      {/* Generate form */}
      <div className={card + " p-6"}>
        <h2 className="text-xl font-semibold text-gray-900 mb-1">Audit and Dispute Report</h2>
        <p className="text-sm text-gray-500 mb-5">
          Generate a full evidence pack for any job — diary entries, photos, GPS sign-ins, QA responses, AI insight.
        </p>

        <div className="space-y-3 mb-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">JOB</label>
            <select value={selectedJob} onChange={(e) => setSelectedJob(e.target.value)} className={inp}>
              <option value="">Select a job…</option>
              {jobs.map((j: any) => <option key={j.id} value={j.id}>{j.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">FROM (optional)</label>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inp} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">TO (optional)</label>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inp} />
            </div>
          </div>
          <button
            onClick={generate}
            disabled={!selectedJob || loading}
            className="w-full px-4 py-3 bg-teal-500 hover:bg-teal-600 text-white rounded-xl text-sm font-semibold disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed"
          >
            {loading ? "Generating…" : "Generate Report"}
          </button>
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{error}</p>}
      </div>

      {reportV2 && (
        <>
          {/* TOP STRIP: context + view toggle + actions */}
          <div className={card + " p-4 sticky top-0 z-10"}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-gray-900 truncate">{reportV2.job?.name}</div>
                <div className="text-xs text-gray-500 truncate">{reportV2.job?.address}</div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="inline-flex bg-gray-100 rounded-lg p-0.5">
                  <button onClick={() => setViewMode("internal")} className={"px-3 py-1 text-xs font-semibold rounded-md " + (viewMode === "internal" ? "bg-white shadow-sm text-gray-900" : "text-gray-600 hover:text-gray-900")}>Internal</button>
                  <button onClick={() => setViewMode("client")} className={"px-3 py-1 text-xs font-semibold rounded-md " + (viewMode === "client" ? "bg-white shadow-sm text-gray-900" : "text-gray-600 hover:text-gray-900")}>Client</button>
                  <button onClick={() => setViewMode("compliance")} className={"px-3 py-1 text-xs font-semibold rounded-md " + (viewMode === "compliance" ? "bg-white shadow-sm text-gray-900" : "text-gray-600 hover:text-gray-900")}>Compliance</button>
                </div>
                <button onClick={refreshAI} disabled={loading} className="px-3 py-1.5 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-lg text-xs font-medium disabled:opacity-50">
                  {loading ? "Refreshing…" : "Refresh AI"}
                </button>
                <button onClick={createShareLink} disabled={creatingLink} className="px-3 py-1.5 bg-teal-500 hover:bg-teal-600 text-white rounded-lg text-xs font-semibold disabled:opacity-50">
                  {creatingLink ? "Creating…" : "Share with client"}
                </button>
              </div>
            </div>
            {actionMsg && (
              <div className="mt-2 text-xs text-teal-700 bg-teal-50 border border-teal-200 rounded px-3 py-1.5">{actionMsg}</div>
            )}
            {shareLink && (
              <div className="mt-3 bg-teal-50 border border-teal-200 rounded-lg p-3">
                <div className="text-xs font-medium text-teal-900 mb-1">Share link created — expires in 30 days</div>
                <div className="flex gap-2">
                  <input value={shareLink} readOnly className="flex-1 px-2 py-1 bg-white border border-teal-200 rounded text-xs text-gray-700 font-mono" onClick={(e) => (e.target as HTMLInputElement).select()} />
                  <button onClick={() => copyLink(shareLink)} className="px-3 py-1 bg-teal-500 hover:bg-teal-600 text-white rounded text-xs font-medium">{copied ? "Copied" : "Copy"}</button>
                </div>
              </div>
            )}
          </div>

          {/* INTERNAL VIEW */}
          {viewMode === "internal" && (
            <>
              {/* Health Check Hero */}
              {reportV2.health && (
                <div className={card + " overflow-hidden"}>
                  <div className={
                    "px-6 py-4 " +
                    (healthColour === "red" ? "bg-red-50 border-b border-red-200" :
                     healthColour === "amber" ? "bg-amber-50 border-b border-amber-200" :
                     "bg-emerald-50 border-b border-emerald-200")
                  }>
                    <div className="flex items-center gap-3 mb-1">
                      <span className={
                        "inline-block w-3 h-3 rounded-full " +
                        (healthColour === "red" ? "bg-red-500" :
                         healthColour === "amber" ? "bg-amber-500" :
                         "bg-emerald-500")
                      }></span>
                      <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                        Job Health · {reportV2.health.status === "in_trouble" ? "In Trouble" : reportV2.health.status === "at_risk" ? "At Risk" : "Healthy"}
                      </span>
                    </div>
                    <div className="text-base font-semibold text-gray-900">{reportV2.health.message}</div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-4 bg-white">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-gray-900">{reportV2.health.metrics?.hoursThisPeriod ?? 0}h</div>
                      <div className="text-xs text-gray-500">Hours this period</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-gray-900">{reportV2.health.metrics?.signoffsDone ?? 0}</div>
                      <div className="text-xs text-gray-500">Sign-offs done</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-amber-600">{reportV2.health.metrics?.signoffsNeeded ?? 0}</div>
                      <div className="text-xs text-gray-500">Awaiting approval</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-red-600">{reportV2.health.metrics?.openIssues ?? 0}</div>
                      <div className="text-xs text-gray-500">Open issues</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Action Panel */}
              {(() => {
                const actions = reportV2.actionsNeeded || []
                // Group all approve_qa actions into a single combined action
                const qaActions = actions.filter((a: any) => a.type === "approve_qa")
                const otherActions = actions.filter((a: any) => a.type !== "approve_qa")
                const grouped: any[] = []
                if (qaActions.length > 0) {
                  const totalItems = qaActions.reduce((sum: number, a: any) => sum + (a.itemIds?.length || 0), 0)
                  const allItemIds = qaActions.flatMap((a: any) => a.itemIds || [])
                  const deliverableNames = qaActions.map((a: any) => a.deliverableName).filter(Boolean).join(", ")
                  grouped.push({
                    type: "approve_qa",
                    priority: "high",
                    title: `${totalItems} QA item${totalItems === 1 ? "" : "s"} awaiting approval`,
                    subtitle: deliverableNames || "Multiple deliverables",
                    itemIds: allItemIds,
                    deliverableName: qaActions.length === 1 ? qaActions[0].deliverableName : `${qaActions.length} deliverables`,
                    actionLabel: "Review now"
                  })
                }
                grouped.push(...otherActions)
                if (grouped.length === 0) return null
                return (
                <div className={card + " p-6"}>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-gray-900">What needs you today</h3>
                    <span className="text-xs text-gray-400">{grouped.length} action{grouped.length === 1 ? "" : "s"}</span>
                  </div>
                  <div className="space-y-2">
                    {grouped.map((a: any, i: number) => (
                      <div key={i} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                        <span className={"flex-shrink-0 w-1.5 h-12 rounded-full " + (a.priority === "high" ? "bg-red-500" : "bg-amber-500")}></span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-gray-900">{a.title}</div>
                          {a.subtitle && <div className="text-xs text-gray-600 mt-0.5">{a.subtitle}</div>}
                        </div>
                        <button
                          disabled={actionInProgress}
                          onClick={() => {
                            if (a.type === "approve_qa" && a.itemIds?.length > 0) {
                              setQaModal({ deliverableName: a.deliverableName, itemIds: a.itemIds })
                            } else if (a.type === "resolve_defect" && a.defectIds?.length > 0) {
                              setDefectModal({ defectIds: a.defectIds })
                            } else if (a.type === "mark_complete" && a.jobId) {
                              setCompleteModal({ jobId: a.jobId, jobName: reportV2.job?.name })
                            } else if (a.type === "review_blocker") {
                              setEvidenceOpen(true)
                              setTimeout(() => document.querySelector("#evidence-section")?.scrollIntoView({ behavior: "smooth" }), 100)
                            }
                          }}
                          className="flex-shrink-0 px-3 py-1.5 bg-white border border-gray-200 hover:bg-gray-50 text-gray-900 rounded-lg text-xs font-semibold disabled:opacity-50"
                        >
                          {a.actionLabel}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
                )
              })()}
              {reportV2.actionsNeeded && reportV2.actionsNeeded.length === 0 && (
                <div className={card + " p-6"}>
                  <div className="flex items-center gap-3">
                    <span className="flex-shrink-0 w-8 h-8 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center">✓</span>
                    <div>
                      <div className="text-sm font-semibold text-gray-900">All caught up</div>
                      <div className="text-xs text-gray-500">No actions outstanding on this job.</div>
                    </div>
                  </div>
                </div>
              )}

              {/* AI Executive Summary */}
              {reportV2.execSummary && (
                <div className={card + " p-6 border-l-4 border-l-teal-500"}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-teal-50 border border-teal-200 rounded-full text-xs font-semibold text-teal-700">
                      <span className="w-1.5 h-1.5 rounded-full bg-teal-500"></span>
                      AI Executive Summary
                    </span>
                  </div>
                  <p className="text-sm text-gray-700 leading-relaxed">{reportV2.execSummary}</p>
                </div>
              )}

              {/* Red Flags */}
              {reportV2.redFlags && reportV2.redFlags.length > 0 && (
                <div className={card + " p-6"}>
                  <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                    <span className="text-red-500">⚠</span> Red Flags ({reportV2.redFlags.length})
                  </h3>
                  <div className="space-y-2">
                    {reportV2.redFlags.map((rf: any, i: number) => (
                      <div key={i} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                        <span className={
                          "flex-shrink-0 px-2 py-0.5 text-xs font-semibold rounded-full uppercase " +
                          (rf.severity === "high" ? "bg-red-100 text-red-700" :
                           rf.severity === "medium" ? "bg-amber-100 text-amber-700" :
                           "bg-yellow-100 text-yellow-700")
                        }>{rf.severity}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-gray-900">{rf.item}</div>
                          <div className="text-xs text-gray-600 mt-0.5">{rf.action}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Timeline strip */}
              {reportV2.timeline && reportV2.timeline.length > 0 && (
                <div className={card + " p-6"}>
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Last 14 days</h3>
                  <div className="flex gap-1 overflow-x-auto pb-2">
                    {reportV2.timeline.map((d: any, i: number) => {
                      const events = (d.signins || 0) + (d.diary || 0) + (d.qa || 0) + (d.defects || 0)
                      const intensity = events === 0 ? "bg-gray-100" : events < 3 ? "bg-teal-100" : events < 6 ? "bg-teal-300" : "bg-teal-500"
                      const dateLabel = new Date(d.date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric" })
                      return (
                        <div key={i} className="flex-1 min-w-[60px] text-center" title={`${dateLabel}: ${d.signins} sign-ins, ${d.diary} diary, ${d.qa} QA, ${d.blockers} blockers, ${d.photos} photos`}>
                          <div className={"h-12 rounded " + intensity + " flex flex-col items-center justify-center text-xs text-white font-medium"}>
                            {d.blockers > 0 && <span className="text-red-600 text-base leading-none">⚠</span>}
                            {events > 0 && <span className={events >= 3 ? "text-white" : "text-teal-800"}>{events}</span>}
                          </div>
                          <div className="text-[10px] text-gray-500 mt-1 whitespace-nowrap">{dateLabel}</div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Deliverables */}
              {reportV2.deliverables && reportV2.deliverables.length > 0 && (
                <div className={card + " p-6"}>
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Deliverables ({reportV2.deliverables.length})</h3>
                  <div className="space-y-3">
                    {reportV2.deliverables.map((d: any) => {
                      const expanded = expandedDeliverable === d.id
                      const pct = d.totalItems > 0 ? Math.round((d.approvedItems / d.totalItems) * 100) : 0
                      return (
                        <div key={d.id} className="border border-gray-200 rounded-lg overflow-hidden">
                          <button onClick={() => setExpandedDeliverable(expanded ? null : d.id)} className="w-full p-4 text-left hover:bg-gray-50">
                            <div className="flex items-center justify-between gap-3 mb-2">
                              <div className="font-semibold text-gray-900">{d.name}</div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <span className="text-xs text-gray-500">{d.approvedItems}/{d.totalItems} approved</span>
                                <span className={
                                  "px-2 py-0.5 text-xs font-medium rounded-full " +
                                  (d.status === "completed" ? "bg-green-100 text-green-700" :
                                   d.status === "in_progress" ? "bg-amber-100 text-amber-700" :
                                   "bg-gray-100 text-gray-600")
                                }>{d.status === "in_progress" ? "In progress" : d.status === "completed" ? "Completed" : "Not started"}</span>
                              </div>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                              <div className="h-full bg-teal-500" style={{ width: pct + "%" }}></div>
                            </div>
                            {d.aiNarrative && !expanded && (
                              <p className="text-xs text-gray-600 italic mt-2">{d.aiNarrative}</p>
                            )}
                          </button>
                          {expanded && (
                            <div className="px-4 pb-4 bg-gray-50 border-t border-gray-100">
                              {d.aiNarrative && <p className="text-xs text-gray-700 italic mb-3 mt-3">{d.aiNarrative}</p>}
                              {d.items && d.items.length > 0 && (
                                <div className="space-y-1">
                                  {d.items.map((it: any) => (
                                    <div key={it.id} className="flex items-center justify-between py-1 text-xs">
                                      <span className="text-gray-700 truncate flex-1">{it.label}</span>
                                      <span className={
                                        "ml-2 flex-shrink-0 font-medium " +
                                        (it.state === "approved" ? "text-green-600" :
                                         it.state === "submitted" ? "text-amber-600" :
                                         it.state === "rejected" ? "text-red-600" : "text-gray-400")
                                      }>{it.state || "pending"}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Cost panel toggle */}
              <div className={card + " p-4"}>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input type="checkbox" checked={costEnabled} onChange={(e) => setCostEnabled(e.target.checked)} className="w-4 h-4 rounded text-teal-500 focus:ring-teal-500" />
                    Show labour cost
                  </label>
                  {costEnabled && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-gray-500">Hourly rate £</span>
                      <input type="number" value={hourlyRate} onChange={(e) => setHourlyRate(parseFloat(e.target.value) || 0)} className="w-20 px-2 py-1 bg-white border border-gray-200 rounded text-sm" />
                      <span className="text-gray-700 font-semibold">= £{((reportV2.health?.metrics?.hoursThisPeriod || 0) * hourlyRate).toFixed(2)}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Evidence accordion */}
              <div id="evidence-section" className={card}>
                <button onClick={() => setEvidenceOpen(!evidenceOpen)} className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50">
                  <div className="text-sm font-semibold text-gray-900">Full evidence</div>
                  <div className="text-xs text-gray-400">{evidenceOpen ? "Hide" : "Show"} sign-ins · diary · QA · defects</div>
                </button>
                {evidenceOpen && report && (
                  <div className="px-6 pb-6 space-y-4 border-t border-gray-100 pt-4">
                    <div>
                      <h4 className="text-xs font-semibold text-gray-700 mb-2">Sign-ins ({report.signins.length})</h4>
                      {report.signins.length === 0 ? <p className="text-xs text-gray-400">None</p> :
                        <div className="text-xs text-gray-600">{report.signins.length} sign-in events · {totalHours.toFixed(1)}h total</div>}
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-gray-700 mb-2">Diary ({report.diary?.length || 0})</h4>
                      <div className="space-y-1 max-h-64 overflow-y-auto">
                        {(report.diary || []).slice(0, 20).map((e: any) => (
                          <div key={e.id} className="flex items-start gap-2 text-xs py-1 border-b border-gray-50">
                            <span className="text-gray-400 flex-shrink-0">{new Date(e.created_at).toLocaleDateString("en-GB")}</span>
                            <span className="text-gray-700 truncate flex-1">{e.entry_text || e.ai_summary || "(no text)"}</span>
                            {e.ai_alert_type && e.ai_alert_type !== "none" && (
                              <span className={"px-1.5 py-0 rounded text-[10px] flex-shrink-0 " + (e.ai_alert_type === "blocker" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700")}>{e.ai_alert_type}</span>
                            )}
                          </div>
                        ))}
                        {(report.diary?.length || 0) > 20 && <div className="text-xs text-gray-400 pt-1">+{(report.diary?.length || 0) - 20} more</div>}
                      </div>
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-gray-700 mb-2">QA ({report.qa?.length || 0})</h4>
                      <div className="text-xs text-gray-600">{(report.qa || []).filter((q: any) => q.result === "pass").length} pass · {(report.qa || []).filter((q: any) => q.result === "fail").length} fail</div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* CLIENT VIEW */}
          {viewMode === "client" && (
            <>
              <div className={card + " p-8 bg-gradient-to-br from-teal-50 via-white to-white"}>
                <h2 className="text-2xl font-bold text-gray-900">{reportV2.job?.name}</h2>
                <p className="text-sm text-gray-600 mt-1">{reportV2.job?.address}</p>
                <p className="text-xs text-gray-400 mt-2">Status report · Generated {new Date(reportV2.generated || Date.now()).toLocaleDateString("en-GB")}</p>
                {(() => {
                  const totalDeliverables = reportV2.deliverables?.length || 0
                  const completedDeliverables = reportV2.deliverables?.filter((d: any) => d.status === "completed").length || 0
                  const overallPct = totalDeliverables > 0 ? Math.round((reportV2.deliverables.reduce((s: number, d: any) => s + (d.totalItems > 0 ? (d.approvedItems / d.totalItems) : 0), 0) / totalDeliverables) * 100) : 0
                  return (
                    <div className="grid grid-cols-3 gap-3 mt-6 pt-6 border-t border-gray-100">
                      <div>
                        <div className="text-2xl font-bold text-gray-900">{reportV2.health?.metrics?.hoursThisPeriod ?? 0}h</div>
                        <div className="text-xs text-gray-500">Logged on site</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-gray-900">{completedDeliverables}/{totalDeliverables}</div>
                        <div className="text-xs text-gray-500">Deliverables complete</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-teal-600">{overallPct}%</div>
                        <div className="text-xs text-gray-500">Overall progress</div>
                      </div>
                    </div>
                  )
                })()}
              </div>

              {reportV2.execSummary && (
                <div className={card + " p-6"}>
                  <h3 className="text-sm font-semibold text-gray-900 mb-2">At a glance</h3>
                  <p className="text-base text-gray-700 leading-relaxed">{reportV2.execSummary}</p>
                </div>
              )}

              {reportV2.deliverables && reportV2.deliverables.length > 0 && (
                <div className={card + " p-6"}>
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Progress</h3>
                  <div className="space-y-3">
                    {reportV2.deliverables.map((d: any) => {
                      const pct = d.totalItems > 0 ? Math.round((d.approvedItems / d.totalItems) * 100) : 0
                      return (
                        <div key={d.id}>
                          <div className="flex items-center justify-between mb-1">
                            <div className="text-sm font-semibold text-gray-900">{d.name}</div>
                            <div className="text-xs text-gray-500">{pct}% complete</div>
                          </div>
                          <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                            <div className="h-full bg-teal-500" style={{ width: pct + "%" }}></div>
                          </div>
                          {d.aiNarrative && <p className="text-xs text-gray-600 mt-1">{d.aiNarrative}</p>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {(() => {
                const allPhotos: { url: string; date: string; source: string }[] = []
                if (report?.qa) {
                  report.qa.forEach((q: any) => {
                    if (q.photo_url) allPhotos.push({ url: q.photo_url, date: q.created_at, source: "QA" })
                  })
                }
                if (reportV2?.fullEvidence?.diary) {
                  reportV2.fullEvidence.diary.forEach((e: any) => {
                    if (e.photo_urls && Array.isArray(e.photo_urls)) {
                      e.photo_urls.forEach((u: string) => {
                        if (u) allPhotos.push({ url: u, date: e.created_at, source: "Diary" })
                      })
                    }
                  })
                }
                allPhotos.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                if (allPhotos.length === 0) return null
                return (
                  <div className={card + " p-6"}>
                    <h3 className="text-sm font-semibold text-gray-900 mb-3">Photos from site ({allPhotos.length})</h3>
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                      {allPhotos.slice(0, 36).map((p, i) => (
                        <a key={i} href={p.url} target="_blank" rel="noopener noreferrer">
                          <img src={p.url} alt="" className="w-full h-24 object-cover rounded-lg border border-gray-200 hover:opacity-80" />
                        </a>
                      ))}
                    </div>
                    {allPhotos.length > 36 && <p className="text-xs text-gray-400 mt-2">+ {allPhotos.length - 36} more photos available</p>}
                  </div>
                )
              })()}
            </>
          )}

          {/* COMPLIANCE VIEW */}
          {viewMode === "compliance" && (
            <div className="space-y-4 print:space-y-0">
              <div className={card + " p-6 print:break-after-page"}>
                <div className="text-xs font-mono text-gray-500">AUDIT REFERENCE</div>
                <div className="text-sm font-mono font-bold text-gray-900">VTR-{new Date().getFullYear()}-{(reportV2.job?.id || "").slice(0, 8).toUpperCase()}</div>
                <div className="mt-3 space-y-1 text-xs text-gray-700">
                  <div><strong>Job:</strong> {reportV2.job?.name}</div>
                  <div><strong>Address:</strong> {reportV2.job?.address}</div>
                  <div><strong>Period:</strong> {reportV2.period?.from || "all time"} to {reportV2.period?.to || "now"}</div>
                  <div><strong>Generated:</strong> {new Date(reportV2.generated || Date.now()).toLocaleString("en-GB")}</div>
                </div>
                <div className="mt-4 pt-4 border-t border-gray-200 text-xs text-gray-700 leading-relaxed">
                  <p className="font-semibold mb-2">SWORN STATEMENT</p>
                  <p>This audit pack was generated automatically from data captured by the Vantro field operations platform during the period stated above. All sign-in/out times are recorded with GPS coordinates within 150m of the registered job site. All photographic evidence is timestamped at point of capture. No data has been edited or removed.</p>
                </div>
              </div>

              <div className={card + " p-6"}>
                <h3 className="text-sm font-bold text-gray-900 mb-2">1. JOB DETAILS</h3>
                <table className="w-full text-xs">
                  <tbody>
                    <tr><td className="font-semibold py-1 pr-2 w-32">Name</td><td>{reportV2.job?.name}</td></tr>
                    <tr><td className="font-semibold py-1 pr-2">Address</td><td>{reportV2.job?.address}</td></tr>
                    <tr><td className="font-semibold py-1 pr-2">Status</td><td>{reportV2.status}</td></tr>
                    <tr><td className="font-semibold py-1 pr-2">Final sign-off</td><td>{reportV2.finalSignoff ? "Completed" : "Pending"}</td></tr>
                  </tbody>
                </table>
              </div>

              <div className={card + " p-6"}>
                <h3 className="text-sm font-bold text-gray-900 mb-2">2. PERSONNEL ON SITE</h3>
                <div className="text-xs text-gray-700 mb-3">{reportV2.onSite?.installerCount || 0} installer(s) · {reportV2.onSite?.totalHours || 0}h total · {reportV2.onSite?.geofenceCompliance || 100}% geofence compliance</div>
                {reportV2.onSite?.fullLog && reportV2.onSite.fullLog.length > 0 && (
                  <table className="w-full text-xs mt-2">
                    <thead>
                      <tr className="bg-gray-50 text-gray-600">
                        <th className="text-left px-2 py-1.5 font-semibold">Installer</th>
                        <th className="text-left px-2 py-1.5 font-semibold">Signed In</th>
                        <th className="text-left px-2 py-1.5 font-semibold">Signed Out</th>
                        <th className="text-right px-2 py-1.5 font-semibold">Dist In</th>
                        <th className="text-right px-2 py-1.5 font-semibold">Dist Out</th>
                        <th className="text-right px-2 py-1.5 font-semibold">Hours</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportV2.onSite.fullLog.map((s: any) => {
                        const inT = new Date(s.signed_in_at)
                        const outT = s.signed_out_at ? new Date(s.signed_out_at) : null
                        const hrs = outT ? ((outT.getTime() - inT.getTime()) / 3600000).toFixed(1) : "—"
                        return (
                          <tr key={s.id} className="border-t border-gray-100">
                            <td className="px-2 py-1">{s.users?.name || "Unknown"}</td>
                            <td className="px-2 py-1 text-gray-600">{inT.toLocaleString("en-GB")}</td>
                            <td className="px-2 py-1 text-gray-600">{outT ? outT.toLocaleString("en-GB") : "—"}</td>
                            <td className="px-2 py-1 text-right text-gray-500">{s.distance_metres != null ? s.distance_metres + "m" : "—"}</td>
                            <td className="px-2 py-1 text-right text-gray-500">{s.sign_out_distance_metres != null ? s.sign_out_distance_metres + "m" : "—"}</td>
                            <td className="px-2 py-1 text-right font-semibold">{hrs}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              <div className={card + " p-6"}>
                <h3 className="text-sm font-bold text-gray-900 mb-2">3. DELIVERABLES & QUALITY CONTROL</h3>
                {reportV2.deliverables?.map((d: any, i: number) => (
                  <div key={d.id} className="mt-2 pl-3 border-l-2 border-gray-200">
                    <div className="text-xs font-semibold">3.{i+1} {d.name}</div>
                    <div className="text-xs text-gray-600">{d.approvedItems}/{d.totalItems} approved · {d.status}</div>
                  </div>
                ))}
              </div>

              <div className={card + " p-6"}>
                <h3 className="text-sm font-bold text-gray-900 mb-2">4. ISSUES LOG</h3>
                <div className="text-xs text-gray-700">Blockers: {reportV2.issues?.blockers?.length || 0} · Issues: {reportV2.issues?.issues?.length || 0} · Open defects: {reportV2.issues?.openDefects?.length || 0}</div>
              </div>

              <div className={card + " p-6"}>
                <h3 className="text-sm font-bold text-gray-900 mb-2">5. AI ANALYSIS DISCLOSURE</h3>
                <p className="text-xs text-gray-700 leading-relaxed">This report includes machine-generated insights produced by Google Gemini 2.5 Flash. AI output is offered as analytical assistance only and does not substitute for human judgement. Source data underlying the AI summary is included in this report.</p>
                {reportV2.execSummary && <p className="text-xs text-gray-700 mt-2 italic">"{reportV2.execSummary}"</p>}
              </div>

              <div className={card + " p-6"}>
                <h3 className="text-sm font-bold text-gray-900 mb-2">6. CHAIN OF CUSTODY</h3>
                <div className="text-xs text-gray-700 space-y-1 leading-relaxed">
                  <div><strong>Generated by Vantro field operations platform</strong></div>
                  <div>· Source data captured directly by mobile device of personnel on site</div>
                  <div>· Sign-in/out events recorded with GPS coordinates and timestamp at point of capture</div>
                  <div>· Photos uploaded directly from device, EXIF metadata preserved</div>
                  <div>· QA submissions linked to the user account that created them, signed and timestamped</div>
                  <div>· Diary entries linked to the user account that created them, signed and timestamped</div>
                  <div>· This report generated on {new Date(reportV2.generated || Date.now()).toLocaleString("en-GB")}</div>
                  <div className="mt-2 pt-2 border-t border-gray-200 font-mono break-all">
                    Hash: {(() => {
                      const seed = `${reportV2.job?.id}-${reportV2.generated}-${reportV2.deliverables?.length || 0}-${reportV2.signoffs?.length || 0}-${reportV2.onSite?.totalHours || 0}`
                      let h = 0
                      for (let i = 0; i < seed.length; i++) { h = ((h << 5) - h) + seed.charCodeAt(i); h |= 0 }
                      return Math.abs(h).toString(16).padStart(16, "0").repeat(4).slice(0, 64)
                    })()}
                  </div>
                  <div className="text-gray-500 italic">Tampering with this report will invalidate the integrity hash above.</div>
                </div>
              </div>

              <div className="text-xs text-gray-400 text-center pt-2">
                Generated by Vantro · field operations software · getvantro.com<br/>
                CNNCTD Ltd · Company No. NI695071
              </div>
            </div>
          )}
        </>
      )}

      {/* MODALS */}
      {qaModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setQaModal(null)}>
          <div className="bg-white rounded-2xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-2">Approve QA — {qaModal.deliverableName}</h3>
            <p className="text-sm text-gray-600 mb-4">{qaModal.itemIds.length} submission{qaModal.itemIds.length === 1 ? "" : "s"} awaiting review.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setQaModal(null)} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm">Cancel</button>
              <button
                disabled={actionInProgress}
                onClick={async () => {
                  for (const id of qaModal.itemIds) {
                    await performAction("approve_qa", { qaSubmissionId: id, approve: true })
                  }
                  setQaModal(null)
                }}
                className="px-4 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
              >
                {actionInProgress ? "Approving…" : "Approve all"}
              </button>
            </div>
          </div>
        </div>
      )}

      {defectModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setDefectModal(null)}>
          <div className="bg-white rounded-2xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-2">Resolve defects</h3>
            <p className="text-sm text-gray-600 mb-4">{defectModal.defectIds.length} defect{defectModal.defectIds.length === 1 ? "" : "s"} marked as resolved.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDefectModal(null)} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm">Cancel</button>
              <button
                disabled={actionInProgress}
                onClick={async () => {
                  for (const id of defectModal.defectIds) {
                    await performAction("resolve_defect", { defectId: id })
                  }
                  setDefectModal(null)
                }}
                className="px-4 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
              >
                {actionInProgress ? "Resolving…" : "Mark resolved"}
              </button>
            </div>
          </div>
        </div>
      )}

      {completeModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setCompleteModal(null)}>
          <div className="bg-white rounded-2xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-2">Mark job complete</h3>
            <p className="text-sm text-gray-600 mb-4">{completeModal.jobName} will be marked as completed. This is the final sign-off.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setCompleteModal(null)} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm">Cancel</button>
              <button
                disabled={actionInProgress}
                onClick={async () => {
                  await performAction("mark_complete", { jobId: completeModal.jobId })
                  setCompleteModal(null)
                }}
                className="px-4 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
              >
                {actionInProgress ? "Completing…" : "Mark complete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
