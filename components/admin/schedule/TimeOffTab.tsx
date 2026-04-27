"use client"

import { useEffect, useState } from "react"

type TimeOffEntry = {
  id: string
  user_id: string
  type: string
  status: "pending" | "approved" | "rejected"
  start_date: string
  end_date: string
  is_half_day: boolean
  half_day_period: "am" | "pm" | null
  notes: string | null
  created_at: string
  approved_at: string | null
  rejection_reason: string | null
  users: {
    name: string | null
    full_name: string | null
    initials: string | null
  } | null
}

type Filter = "pending" | "approved" | "this_month" | "all"

const TYPE_LABEL: Record<string, string> = {
  annual_leave: "Annual leave",
  sick: "Sick",
  personal: "Personal",
  bereavement: "Bereavement",
  training: "Training",
  unpaid: "Unpaid",
  unavailable: "Unavailable",
}

const TYPE_COLOR: Record<string, { bg: string; text: string }> = {
  annual_leave: { bg: "bg-purple-100", text: "text-purple-800" },
  sick: { bg: "bg-red-100", text: "text-red-800" },
  personal: { bg: "bg-blue-100", text: "text-blue-800" },
  bereavement: { bg: "bg-gray-100", text: "text-gray-800" },
  training: { bg: "bg-amber-100", text: "text-amber-800" },
  unpaid: { bg: "bg-gray-100", text: "text-gray-800" },
  unavailable: { bg: "bg-gray-100", text: "text-gray-800" },
}

function formatDateShort(iso: string) {
  const d = new Date(iso + "T00:00:00")
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

function formatRange(start: string, end: string, isHalfDay: boolean) {
  const r = start === end ? formatDateShort(start) : `${formatDateShort(start)} → ${formatDateShort(end)}`
  return isHalfDay ? `${r} (½ day)` : r
}

function daysCount(start: string, end: string, isHalfDay: boolean): number {
  if (isHalfDay) return 0.5
  const s = new Date(start + "T00:00:00").getTime()
  const e = new Date(end + "T00:00:00").getTime()
  return Math.round((e - s) / 86400000) + 1
}

function timeAgo(iso: string) {
  const t = new Date(iso).getTime()
  const now = Date.now()
  const days = Math.floor((now - t) / 86400000)
  if (days === 0) return "today"
  if (days === 1) return "1 day ago"
  return `${days} days ago`
}

export default function TimeOffTab() {
  const [filter, setFilter] = useState<Filter>("pending")
  const [entries, setEntries] = useState<TimeOffEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    let url = "/api/admin/time-off?status="
    if (filter === "pending") url += "pending"
    else if (filter === "approved") url += "approved"
    else if (filter === "this_month") {
      const today = new Date()
      const start = new Date(today.getFullYear(), today.getMonth(), 1)
        .toISOString()
        .slice(0, 10)
      const end = new Date(today.getFullYear(), today.getMonth() + 1, 0)
        .toISOString()
        .slice(0, 10)
      url = `/api/admin/time-off?status=all&from=${start}&to=${end}`
    } else url += "all"
    const res = await fetch(url).then((r) => r.json())
    setEntries(res?.entries || [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [filter])

  async function decide(id: string, status: "approved" | "rejected") {
    setBusy(id)
    setError(null)
    const res = await fetch(`/api/admin/time-off/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    })
    setBusy(null)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(j.error || `Failed (${res.status})`)
      return
    }
    load()
  }

  const pendingCount = entries.filter((e) => e.status === "pending").length

  return (
    <div className="space-y-3">
      {/* Filter row */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5">
          <FilterChip
            active={filter === "pending"}
            onClick={() => setFilter("pending")}
            label={`Pending${filter === "pending" ? ` ${entries.length}` : ""}`}
            warn={filter === "pending" && pendingCount > 0}
          />
          <FilterChip
            active={filter === "approved"}
            onClick={() => setFilter("approved")}
            label="Approved"
          />
          <FilterChip
            active={filter === "this_month"}
            onClick={() => setFilter("this_month")}
            label="This month"
          />
          <FilterChip
            active={filter === "all"}
            onClick={() => setFilter("all")}
            label="All time"
          />
        </div>
        {/* Add manual button — TODO Phase 3.1 wires the modal */}
      </div>

      {error && (
        <div className="text-sm text-red-500 px-1">{error}</div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading time off...</div>
      ) : entries.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center text-gray-400 text-sm">
          {filter === "pending"
            ? "No pending requests."
            : "No time off entries."}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          {entries.map((e) => {
            const u = e.users || ({} as any)
            const name = u.name || u.full_name || "(unnamed)"
            const initials = u.initials || name.slice(0, 2).toUpperCase()
            const typeColor = TYPE_COLOR[e.type] || {
              bg: "bg-gray-100",
              text: "text-gray-800",
            }
            const days = daysCount(e.start_date, e.end_date, e.is_half_day)
            return (
              <div
                key={e.id}
                className="grid grid-cols-[32px_1fr_180px_60px_200px] gap-3 items-center px-5 py-3 border-b border-gray-100 last:border-0"
              >
                <div
                  className={
                    "w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium " +
                    typeColor.bg +
                    " " +
                    typeColor.text
                  }
                >
                  {initials}
                </div>
                <div>
                  <div className="text-sm">{name}</div>
                  <div className="text-[11px] text-gray-500 mt-0.5">
                    {TYPE_LABEL[e.type] || e.type}
                    {e.notes ? ` · "${e.notes}"` : ""}
                    {e.status === "pending" && (
                      <span className="ml-2 text-amber-700">
                        · waiting {timeAgo(e.created_at)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-xs text-gray-600">
                  {formatRange(e.start_date, e.end_date, e.is_half_day)}
                </div>
                <div className="text-[11px] text-gray-500">{days} days</div>
                <div className="flex justify-end">
                  {e.status === "pending" ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => decide(e.id, "rejected")}
                        disabled={busy === e.id}
                        className="px-3 py-1 text-[11px] border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-50"
                      >
                        Decline
                      </button>
                      <button
                        onClick={() => decide(e.id, "approved")}
                        disabled={busy === e.id}
                        className="px-3 py-1 text-[11px] bg-teal-400 hover:bg-teal-500 text-white font-medium rounded-md disabled:opacity-50"
                      >
                        {busy === e.id ? "..." : "Approve"}
                      </button>
                    </div>
                  ) : e.status === "approved" ? (
                    <span className="text-[11px] text-teal-700 font-medium">
                      Approved
                    </span>
                  ) : (
                    <span className="text-[11px] text-gray-500">
                      Declined
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="text-xs text-gray-500 px-1">
        Approved time off automatically suppresses no-show alerts and excludes
        the day from compliance scoring.
      </div>
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  label,
  warn = false,
}: {
  active: boolean
  onClick: () => void
  label: string
  warn?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={
        "px-3 py-1.5 rounded-md text-xs font-medium border transition-colors " +
        (active
          ? warn
            ? "bg-amber-600 text-white border-amber-600"
            : "bg-teal-400 text-white border-teal-400"
          : "bg-white text-gray-600 border-gray-200 hover:border-teal-300")
      }
    >
      {label}
    </button>
  )
}
