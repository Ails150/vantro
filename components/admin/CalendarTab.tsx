"use client"

import { useState, useEffect, useMemo, useCallback } from "react"

interface Installer {
  id: string
  name: string
  initials: string | null
}

interface Visit {
  id: string
  job_id: string
  start_at: string
  end_at: string | null
  status: string
  jobs: { name: string; address: string; lat: number | null; lng: number | null } | null
}

interface Assignment {
  id: string
  visit_id: string
  user_id: string
  role: string | null
}

interface TimeOff {
  id: string
  user_id: string
  type: string
  status: string
  start_date: string
  end_date: string
  is_half_day: boolean
}

interface PublicHoliday {
  date: string
  name: string
}

interface CalendarData {
  window: { start: string; end: string }
  installers: Installer[]
  visits: Visit[]
  assignments: Assignment[]
  time_off: TimeOff[]
  public_holidays: PublicHoliday[]
}

interface JobLite {
  id: string
  name: string
  address?: string | null
  status?: string | null
}

const TYPE_LABELS: Record<string, string> = {
  annual_leave: "Annual leave",
  sick: "Sick",
  personal: "Personal",
  bereavement: "Bereavement",
  training: "Training",
  unpaid: "Unpaid",
  unavailable: "Unavailable",
}

export default function CalendarTab() {
  // Anchor "current week" on a Monday
  const [weekStart, setWeekStart] = useState<Date | null>(null)
  const [viewMode, setViewMode] = useState<"week" | "month">("week")
  const [draggedAssignment, setDraggedAssignment] = useState<{ id: string; user_id: string; visit_id: string } | null>(null)
  const [selectedAssignment, setSelectedAssignment] = useState<{ id: string; user_id: string; visit_id: string } | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; assignmentId: string; jobName: string; dateRange: string } | null>(null)
  const [assignModal, setAssignModal] = useState<{ user_id: string; user_name: string; date: string } | null>(null)
  const [jobs, setJobs] = useState<JobLite[]>([])
  const [jobSearch, setJobSearch] = useState("")
  const [assigning, setAssigning] = useState(false)
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null)
  useEffect(() => { setWeekStart(getMondayOf(new Date())) }, [])
  const numWeeks = viewMode === "month" ? 4 : 1
  const numDays = numWeeks * 7
  const [data, setData] = useState<CalendarData | null>(null)
  const [loading, setLoading] = useState(true)

  // Compute week's 7 dates
  const weekDates = useMemo(() => {
    if (!weekStart) return []
    const dates: Date[] = []
    for (let i = 0; i < numDays; i++) {
      const d = new Date(weekStart)
      d.setDate(d.getDate() + i)
      dates.push(d)
    }
    return dates
  }, [weekStart, numDays])

  // Group dates into weeks (always 7 per row, even if numDays > 7)
  const weekRows = useMemo(() => {
    const rows: Date[][] = []
    for (let i = 0; i < weekDates.length; i += 7) {
      rows.push(weekDates.slice(i, i + 7))
    }
    return rows
  }, [weekDates])

  const fmtDate = (d: Date) => d.toISOString().slice(0, 10)
  const startStr = weekDates.length > 0 ? fmtDate(weekDates[0]) : ""
  const endStr = weekDates.length > 0 ? fmtDate(weekDates[weekDates.length - 1]) : ""

  const load = useCallback(async () => {
    if (!startStr || !endStr) return
    setLoading(true)
    try {
      const res = await fetch(
        `/api/admin/calendar?start=${startStr}&end=${endStr}`
      )
      const json = await res.json()
      setData(json)
    } catch (err) {
      console.error("[calendar] load failed", err)
    }
    setLoading(false)
  }, [startStr, endStr])

  useEffect(() => {
    load()
  }, [load])

  const goPrev = () => {
    if (!weekStart) return
    const d = new Date(weekStart)
    d.setDate(d.getDate() - numDays)
    setWeekStart(d)
  }
  const goNext = () => {
    if (!weekStart) return
    const d = new Date(weekStart)
    d.setDate(d.getDate() + numDays)
    setWeekStart(d)
  }
  const goToday = () => setWeekStart(getMondayOf(new Date()))

  // Build a lookup: which visits cover each (installer_id, date)?
  const cellMap = useMemo(() => {
    const map: Record<string, { visitChips: Array<{ visit: Visit; assignmentId: string }>; timeOff: TimeOff | null; isPublicHoliday: PublicHoliday | null }> = {}
    if (!data || !data.installers) return map

    const holidayByDate: Record<string, PublicHoliday> = {}
    for (const h of (data.public_holidays || [])) holidayByDate[h.date] = h

    // Index assignments by user → set of visit_ids
    const assignmentsByUser: Record<string, Map<string, string>> = {}
    for (const a of data.assignments) {
      if (!assignmentsByUser[a.user_id]) assignmentsByUser[a.user_id] = new Map()
      assignmentsByUser[a.user_id].set(a.visit_id, a.id)
    }

    // Index visits by id
    const visitById: Record<string, Visit> = {}
    for (const v of data.visits) visitById[v.id] = v

    // Index time off by (user, date)
    const timeOffByCell: Record<string, TimeOff> = {}
    for (const t of data.time_off) {
      const days = expandDates(t.start_date, t.end_date)
      for (const d of days) timeOffByCell[`${t.user_id}|${d}`] = t
    }

    // For each installer × date, find which visits apply
    for (const installer of data.installers) {
      for (const dateObj of weekDates) {
        const dateStr = fmtDate(dateObj)
        const cellKey = `${installer.id}|${dateStr}`

        const installerAssignments = assignmentsByUser[installer.id] || new Map<string, string>()
        const cellChips: Array<{ visit: Visit; assignmentId: string }> = []
        for (const [vid, aid] of installerAssignments) {
          const v = visitById[vid]
          if (!v) continue
          const visitStart = v.start_at.slice(0, 10)
          const visitEnd = v.end_at ? v.end_at.slice(0, 10) : visitStart
          if (dateStr < visitStart) continue
          if (dateStr > visitEnd) continue
          cellChips.push({ visit: v, assignmentId: aid })
        }

        map[cellKey] = {
          visitChips: cellChips,
          timeOff: timeOffByCell[cellKey] || null,
          isPublicHoliday: holidayByDate[dateStr] || null,
        }
      }
    }

    return map
  }, [data, weekDates])

  // Handle drop: optimistic UI + PATCH
  // Fetch jobs lazily when modal opens
  useEffect(() => {
    if (!assignModal || jobs.length > 0) return
    fetch("/api/admin/jobs")
      .then((r) => r.json())
      .then((j) => setJobs((j.jobs || []).map((job: any) => ({ id: job.id, name: job.name, address: job.address, status: job.status }))))
      .catch((err) => console.error("[calendar] failed to load jobs", err))
  }, [assignModal, jobs.length])

  const handleAssign = useCallback(async (job_id: string) => {
    if (!assignModal) return
    setAssigning(true)
    try {
      const res = await fetch("/api/admin/visit-assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id, user_id: assignModal.user_id, date: assignModal.date }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert("Assign failed: " + (j.error || res.statusText))
      }
    } catch (err) {
      alert("Assign failed - network error")
    }
    setAssigning(false)
    setAssignModal(null)
    load()
  }, [assignModal, load])

  const handleRemove = useCallback(async (assignmentId: string, jobName: string, dateRange: string) => {
    if (!confirm(`Remove ${jobName} (${dateRange}) from this installer?\n\nThis removes the assignment for the whole visit, not just one day.`)) return
    try {
      const res = await fetch(`/api/admin/visit-assignments/${assignmentId}`, { method: "DELETE" })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert("Remove failed: " + (j.error || res.statusText))
      }
    } catch (err) {
      alert("Remove failed - network error")
    }
    load()
  }, [load])

  const handleDrop = useCallback(async (
    src: { id: string; user_id: string; visit_id: string },
    targetUserId: string,
    targetDate: string
  ) => {
    if (!data) return
    const sourceVisit = data.visits.find((v) => v.id === src.visit_id)
    if (!sourceVisit) return
    const sourceDate = sourceVisit.start_at.slice(0, 10)
    if (src.user_id === targetUserId && sourceDate === targetDate) return

    const body: any = {}
    if (targetUserId !== src.user_id) body.user_id = targetUserId
    if (sourceDate !== targetDate) body.target_date = targetDate

    try {
      const res = await fetch(`/api/admin/visit-assignments/${src.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        console.error("[calendar move failed]", j)
        alert("Move failed: " + (j.error || res.statusText))
      }
    } catch (err) {
      console.error("[calendar move error]", err)
      alert("Move failed - network error")
    }
    load()
  }, [data, load])

  // Format helpers
  const weekLabel = useMemo(() => {
    if (weekDates.length === 0) return ""
    const start = weekDates[0]
    const end = weekDates[weekDates.length - 1]
    const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()
    if (sameMonth) {
      return `${start.getDate()} – ${end.getDate()} ${start.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}`
    }
    return `${start.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${end.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
  }, [weekDates])

  const today = new Date()
  const todayStr = fmtDate(today)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-xl font-medium text-gray-900">Calendar</h2>
        <p className="text-sm text-gray-500">
          Visual schedule of who is working where, including time off and public holidays.
        </p>
      </div>

      {/* Nav bar */}
      <div className="flex items-center justify-between bg-white rounded-xl border border-gray-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            onClick={goPrev}
            className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
          >
            ←
          </button>
          <button
            onClick={goToday}
            className="px-3 py-1.5 rounded-lg bg-teal-50 text-teal-700 text-sm font-medium hover:bg-teal-100"
          >
            Today
          </button>
          <button
            onClick={goNext}
            className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
          >
            →
          </button>
          <div className="ml-3 flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setViewMode("week")}
              className={"px-3 py-1 rounded-md text-xs font-medium transition-colors " + (viewMode === "week" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700")}
            >
              Week
            </button>
            <button
              onClick={() => setViewMode("month")}
              className={"px-3 py-1 rounded-md text-xs font-medium transition-colors " + (viewMode === "month" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700")}
            >
              4 weeks
            </button>
          </div>
        </div>
        <div className="text-base font-medium text-gray-900">{weekLabel}</div>
        <div className="text-sm text-gray-500">
          {data?.installers?.length || 0} installers
        </div>
      </div>

      {loading && !data ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-500">
          Loading calendar...
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-4 py-3 font-medium text-gray-500 sticky left-0 bg-white z-10 min-w-[180px]">
                  Installer
                </th>
                {weekDates.map((d, i) => {
                  const dateStr = fmtDate(d)
                  const isToday = dateStr === todayStr
                  const ph = (data?.public_holidays || []).find((h) => h.date === dateStr)
                  const dayName = d.toLocaleDateString("en-GB", { weekday: "short" })
                  const dayNum = d.getDate()
                  const isWeekend = i >= 5
                  return (
                    <th
                      key={dateStr}
                      className={`text-center px-2 py-3 font-medium min-w-[120px] ${
                        isWeekend ? "bg-gray-50" : ""
                      } ${ph ? "bg-amber-50" : ""}`}
                    >
                      <div className={`text-xs ${isToday ? "text-teal-600 font-semibold" : "text-gray-500"}`}>
                        {dayName}
                      </div>
                      <div className={`text-base ${isToday ? "text-teal-600 font-semibold" : "text-gray-900"}`}>
                        {dayNum}
                      </div>
                      {ph && (
                        <div className="text-[10px] text-amber-700 mt-0.5 truncate" title={ph.name}>
                          {ph.name}
                        </div>
                      )}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {(data?.installers || []).map((inst) => (
                <tr key={inst.id} className="border-b border-gray-50 hover:bg-gray-50/40">
                  <td className="px-4 py-3 sticky left-0 bg-white z-10 min-w-[180px]">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-teal-50 text-teal-700 text-xs font-medium flex items-center justify-center">
                        {inst.initials || inst.name.slice(0, 2).toUpperCase()}
                      </div>
                      <span className="text-gray-900 font-medium truncate">{inst.name}</span>
                    </div>
                  </td>
                  {weekDates.map((d, i) => {
                    const dateStr = fmtDate(d)
                    const cell = cellMap[`${inst.id}|${dateStr}`]
                    const isWeekend = i >= 5
                    const cellKeyForDrop = `${inst.id}|${dateStr}`
                    const isDropTarget = dropTargetKey === cellKeyForDrop
                    return (
                      <td
                        key={dateStr}
                        className={`px-2 py-2 align-top transition-colors ${
                          isDropTarget ? "bg-blue-50" : isWeekend ? "bg-gray-50/40" : ""
                        } ${cell?.isPublicHoliday && !isDropTarget ? "bg-amber-50/40" : ""}`}
                        onDragOver={(e) => {
                          if (!draggedAssignment) return
                          if (cell?.timeOff) return
                          e.preventDefault()
                          if (dropTargetKey !== cellKeyForDrop) setDropTargetKey(cellKeyForDrop)
                        }}
                        onDragLeave={(e) => {
                          if (e.currentTarget === e.target) setDropTargetKey(null)
                        }}
                        onDrop={(e) => {
                          e.preventDefault()
                          setDropTargetKey(null)
                          if (!draggedAssignment) return
                          handleDrop(draggedAssignment, inst.id, dateStr)
                        }}
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest('[data-chip="true"]')) return
                          if (selectedAssignment) {
                            handleDrop(selectedAssignment, inst.id, dateStr)
                            setSelectedAssignment(null)
                            return
                          }
                          if (cell?.timeOff) return
                          // Empty cell click -> open assign modal
                          setAssignModal({ user_id: inst.id, user_name: inst.name, date: dateStr })
                          setJobSearch("")
                        }}
                      >
                        <div className={`flex flex-col gap-1 min-h-[56px] rounded-md transition-colors ${
                          selectedAssignment && !cell?.timeOff && !(cell?.visitChips && cell.visitChips.length > 0)
                            ? "border border-dashed border-blue-300 bg-blue-50/30 hover:bg-blue-100/50 cursor-pointer"
                            : !selectedAssignment && !cell?.timeOff && !(cell?.visitChips && cell.visitChips.length > 0)
                            ? "hover:bg-teal-50/30 hover:border hover:border-dashed hover:border-teal-300 cursor-pointer"
                            : ""
                        }`}>
                          {cell?.timeOff && (
                            <div className="bg-amber-100 border border-amber-200 rounded-md px-2 py-1 text-[11px] text-amber-800">
                              {TYPE_LABELS[cell.timeOff.type] || cell.timeOff.type}
                              {cell.timeOff.is_half_day ? " (half day)" : ""}
                            </div>
                          )}
                          {!cell?.timeOff &&
                            cell?.visitChips.map(({ visit: v, assignmentId }) => {
                              const isDragging = draggedAssignment?.id === assignmentId
                              return (
                                <div
                                  key={assignmentId}
                                  draggable
                                  onDragStart={(e) => {
                                    e.dataTransfer.effectAllowed = "move"
                                    setDraggedAssignment({ id: assignmentId, user_id: inst.id, visit_id: v.id })
                                  }}
                                  onDragEnd={() => {
                                    setDraggedAssignment(null)
                                    setDropTargetKey(null)
                                  }}
                                  onContextMenu={(e) => {
                                    e.preventDefault()
                                    const startD = v.start_at.slice(0, 10)
                                    const endD = v.end_at ? v.end_at.slice(0, 10) : startD
                                    const dateRange = startD === endD ? startD : `${startD} to ${endD}`
                                    setContextMenu({ x: e.clientX, y: e.clientY, assignmentId, jobName: v.jobs?.name || "Job", dateRange })
                                  }}
                                  data-chip="true"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    if (selectedAssignment?.id === assignmentId) {
                                      setSelectedAssignment(null)
                                    } else {
                                      setSelectedAssignment({ id: assignmentId, user_id: inst.id, visit_id: v.id })
                                    }
                                  }}
                                  className={`bg-teal-50 border rounded-md px-2 py-1 text-[11px] text-teal-800 truncate cursor-pointer active:cursor-grabbing transition-all ${isDragging ? "opacity-40" : ""} ${selectedAssignment?.id === assignmentId ? "border-blue-500 ring-2 ring-blue-200 bg-blue-50" : "border-teal-200"}`}
                                  title={`${v.jobs?.name || "Job"}${v.jobs?.address ? " - " + v.jobs.address : ""}`}
                                >
                                  {v.jobs?.name || "Job"}
                                </div>
                              )
                            })}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
              {(!data?.installers || data.installers.length === 0) && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-500">
                    No installers found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-500">
        Click an empty cell to assign a job. Click a chip to select, then click a cell to move. Right-click chip to remove.
      </p>

      {assignModal && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setAssignModal(null)} />
          <div className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-xl border border-gray-200 w-[480px] max-w-[90vw] max-h-[80vh] flex flex-col">
            <div className="px-5 py-4 border-b border-gray-100">
              <div className="text-base font-medium text-gray-900">Assign job</div>
              <div className="text-sm text-gray-500 mt-0.5">{assignModal.user_name} on {assignModal.date}</div>
            </div>
            <div className="px-5 py-3 border-b border-gray-100">
              <input
                type="text"
                placeholder="Search jobs..."
                value={jobSearch}
                onChange={(e) => setJobSearch(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-teal-400"
                autoFocus
              />
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-2">
              {jobs.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-gray-400">Loading jobs...</div>
              ) : (
                jobs
                  .filter((j) => {
                    if (!jobSearch.trim()) return true
                    const q = jobSearch.toLowerCase()
                    return j.name.toLowerCase().includes(q) || (j.address || "").toLowerCase().includes(q)
                  })
                  .slice(0, 50)
                  .map((j) => (
                    <button
                      key={j.id}
                      onClick={() => handleAssign(j.id)}
                      disabled={assigning}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-teal-50 disabled:opacity-50 transition-colors"
                    >
                      <div className="text-sm font-medium text-gray-900 truncate">{j.name}</div>
                      {j.address && <div className="text-xs text-gray-500 truncate">{j.address}</div>}
                    </button>
                  ))
              )}
              {jobs.length > 0 && jobs.filter((j) => {
                if (!jobSearch.trim()) return true
                const q = jobSearch.toLowerCase()
                return j.name.toLowerCase().includes(q) || (j.address || "").toLowerCase().includes(q)
              }).length === 0 && (
                <div className="px-3 py-6 text-center text-sm text-gray-400">No jobs match "{jobSearch}"</div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-gray-100 flex justify-end">
              <button
                onClick={() => setAssignModal(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-lg"
              >
                Cancel
              </button>
            </div>
          </div>
        </>
      )}

      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />
          <div
            className="fixed z-50 bg-white border border-gray-200 rounded-xl shadow-lg py-1 w-48"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <div className="px-3 py-2 text-[11px] text-gray-500 border-b border-gray-100 truncate" title={contextMenu.jobName}>
              {contextMenu.jobName}
            </div>
            <button
              onClick={() => {
                const id = contextMenu.assignmentId
                const jn = contextMenu.jobName
                const dr = contextMenu.dateRange
                setContextMenu(null)
                handleRemove(id, jn, dr)
              }}
              className="w-full text-left text-xs px-3 py-2 text-red-600 hover:bg-red-50"
            >
              Remove assignment
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// Helpers

function getMondayOf(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay() // Sunday=0, Monday=1, ...
  const diff = day === 0 ? -6 : 1 - day // Roll back to Monday
  d.setDate(d.getDate() + diff)
  return d
}

function expandDates(start: string, end: string): string[] {
  const result: string[] = []
  const s = new Date(start + "T00:00:00Z")
  const e = new Date(end + "T00:00:00Z")
  for (let d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
    result.push(d.toISOString().slice(0, 10))
  }
  return result
}
