"use client"
import { useEffect, useState } from "react"

type Signal = "green" | "yellow" | "red" | "unknown"

type Job = {
  id: string
  name: string
  start_date: string | null
  end_date: string | null
  budget_hours: number | null
  actual_hours: number
  days_remaining: number | null
  time_elapsed_pct: number | null
  hours_pct: number | null
  days_since_last_diary: number | null
  open_blockers: number
  checklist_total: number
  checklist_complete: number
  signals: { calendar: Signal; hours: Signal; activity: Signal }
  overall: Signal
  why: string | null
  recent_diary: { text: string; alert_type: string; at: string }[]
}

type Payload = {
  generated_at: string
  job_count: number
  jobs: Job[]
  cached?: boolean
}

const STATUS_RANK: Record<Signal, number> = { red: 0, yellow: 1, unknown: 2, green: 3 }

function dotColor(s: Signal) {
  if (s === "red") return "bg-red-500"
  if (s === "yellow") return "bg-amber-400"
  if (s === "green") return "bg-teal-500"
  return "bg-gray-300"
}

function statusBadge(s: Signal) {
  if (s === "red") return "bg-red-50 text-red-700 border-red-200"
  if (s === "yellow") return "bg-amber-50 text-amber-700 border-amber-200"
  if (s === "green") return "bg-teal-50 text-teal-700 border-teal-200"
  return "bg-gray-50 text-gray-500 border-gray-200"
}

function statusLabel(s: Signal) {
  if (s === "red") return "OVERRUN"
  if (s === "yellow") return "AT RISK"
  if (s === "green") return "ON TRACK"
  return "NOT SET"
}

export default function JobProgressTab() {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editStart, setEditStart] = useState("")
  const [editEnd, setEditEnd] = useState("")
  const [editBudget, setEditBudget] = useState("")
  const [saving, setSaving] = useState(false)

  async function load(force = false) {
    if (force) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const url = force ? "/api/admin/job-progress?refresh=1" : "/api/admin/job-progress"
      const res = await fetch(url)
      const j = await res.json()
      if (!res.ok) throw new Error(j.detail || j.error || "Failed to load")
      setData(j)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => { load(false) }, [])

  function startEdit(j: Job) {
    setEditingId(j.id)
    setEditStart(j.start_date || "")
    setEditEnd(j.end_date || "")
    setEditBudget(j.budget_hours != null ? String(j.budget_hours) : "")
  }

  async function saveEdit(jobId: string) {
    setSaving(true)
    try {
      const res = await fetch("/api/admin/jobs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          start_date: editStart || null,
          end_date: editEnd || null,
          budget_hours: editBudget === "" ? null : Number(editBudget),
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.detail || j.error || "Save failed")
      }
      setEditingId(null)
      await load(true)
    } catch (e: any) {
      alert("Save failed: " + e.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="px-6 py-12 text-sm text-gray-400 text-center">Loading job progress...</div>
  if (error) return <div className="px-6 py-6 text-sm text-red-500">Error: {error}</div>
  if (!data || data.jobs.length === 0) return (
    <div className="px-6 py-12 text-center">
      <div className="text-sm text-gray-400">No active jobs</div>
    </div>
  )

  const sortedJobs = [...data.jobs].sort((a, b) => STATUS_RANK[a.overall] - STATUS_RANK[b.overall])
  const counts = {
    red: sortedJobs.filter(j => j.overall === "red").length,
    yellow: sortedJobs.filter(j => j.overall === "yellow").length,
    green: sortedJobs.filter(j => j.overall === "green").length,
    unknown: sortedJobs.filter(j => j.overall === "unknown").length,
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-lg font-bold text-gray-800">Job Progress</h2>
          <div className="flex items-center gap-2">
            {counts.red > 0 && <span className="text-xs bg-red-50 text-red-700 border border-red-200 px-2 py-1 rounded-full font-semibold">{counts.red} OVERRUN</span>}
            {counts.yellow > 0 && <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-1 rounded-full font-semibold">{counts.yellow} AT RISK</span>}
            {counts.green > 0 && <span className="text-xs bg-teal-50 text-teal-700 border border-teal-200 px-2 py-1 rounded-full font-semibold">{counts.green} ON TRACK</span>}
            {counts.unknown > 0 && <span className="text-xs bg-gray-50 text-gray-500 border border-gray-200 px-2 py-1 rounded-full">{counts.unknown} NOT SET</span>}
          </div>
        </div>
        <button onClick={() => load(true)} disabled={refreshing} className="text-xs bg-white border border-gray-200 hover:border-teal-300 rounded-lg px-3 py-1.5 font-medium text-gray-700 disabled:opacity-50">
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {sortedJobs.map((j) => (
          <div key={j.id} className="bg-white border border-gray-200 rounded-2xl p-5">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="flex items-center gap-2 flex-wrap">
                <div className={"w-3 h-3 rounded-full " + dotColor(j.overall)}></div>
                <h3 className="font-bold text-gray-800 text-base">{j.name}</h3>
                <span className={"text-xs border px-2 py-0.5 rounded-full font-semibold " + statusBadge(j.overall)}>
                  {statusLabel(j.overall)}
                </span>
              </div>
              <button onClick={() => startEdit(j)} className="text-xs text-teal-600 hover:text-teal-700 font-medium">
                {editingId === j.id ? "Cancel" : "Edit"}
              </button>
            </div>

            {editingId === j.id ? (
              <div className="space-y-3 bg-gray-50 rounded-xl p-3 mb-4">
                <div>
                  <label className="text-xs text-gray-600 block mb-1">Start date</label>
                  <input type="date" value={editStart} onChange={e => setEditStart(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white" />
                </div>
                <div>
                  <label className="text-xs text-gray-600 block mb-1">End date</label>
                  <input type="date" value={editEnd} onChange={e => setEditEnd(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white" />
                </div>
                <div>
                  <label className="text-xs text-gray-600 block mb-1">Budget hours</label>
                  <input type="number" step="0.5" value={editBudget} onChange={e => setEditBudget(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white" placeholder="e.g. 80" />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => saveEdit(j.id)} disabled={saving} className="flex-1 bg-teal-500 hover:bg-teal-600 text-white text-sm font-semibold rounded-lg px-3 py-2 disabled:opacity-50">
                    {saving ? "Saving..." : "Save"}
                  </button>
                  <button onClick={() => setEditingId(null)} className="text-sm text-gray-500 px-3 py-2">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="space-y-2 mb-3">
                <SignalRow label="Calendar" signal={j.signals.calendar} detail={
                  j.end_date == null ? "End date not set"
                  : j.days_remaining == null ? ""
                  : j.days_remaining < 0 ? `${Math.abs(j.days_remaining)} day${Math.abs(j.days_remaining) === 1 ? "" : "s"} OVERDUE`
                  : `${j.days_remaining} day${j.days_remaining === 1 ? "" : "s"} remaining` + (j.time_elapsed_pct != null ? ` (${j.time_elapsed_pct}% time elapsed)` : "")
                } />
                <SignalRow label="Hours" signal={j.signals.hours} detail={
                  j.budget_hours == null ? "Budget not set"
                  : `${j.actual_hours}h of ${j.budget_hours}h${j.hours_pct != null ? ` (${j.hours_pct}%)` : ""}`
                } />
                <SignalRow label="Activity" signal={j.signals.activity} detail={
                  j.days_since_last_diary == null ? "No diary entries yet"
                  : j.days_since_last_diary === 0 ? "Diary entry today"
                  : `Last diary ${j.days_since_last_diary} day${j.days_since_last_diary === 1 ? "" : "s"} ago`
                } />
                {j.checklist_total > 0 && (
                  <SignalRow label="Checklist" signal="unknown" detail={`${j.checklist_complete} of ${j.checklist_total} items signed off`} />
                )}
                {j.open_blockers > 0 && (
                  <div className="text-xs text-red-600 mt-2">
                    {j.open_blockers} open blocker{j.open_blockers === 1 ? "" : "s"}
                  </div>
                )}
              </div>
            )}

            {j.why && editingId !== j.id && (
              <div className={"text-xs rounded-lg p-3 mt-3 border " + statusBadge(j.overall)}>
                <span className="font-semibold uppercase tracking-wide block mb-1">Why</span>
                {j.why}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="text-xs text-gray-400 text-center pt-2">
        {data.cached ? "Showing cached results · " : ""}
        Generated {new Date(data.generated_at).toLocaleString("en-GB")}
      </div>
    </div>
  )
}

function SignalRow({ label, signal, detail }: { label: string; signal: Signal; detail: string }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <div className={"w-2 h-2 rounded-full mt-1.5 flex-shrink-0 " + dotColor(signal)}></div>
      <div className="flex-1 min-w-0">
        <span className="font-semibold text-gray-700 mr-2">{label}:</span>
        <span className="text-gray-600">{detail}</span>
      </div>
    </div>
  )
}
