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
    const map: Record<string, { visits: Visit[]; timeOff: TimeOff | null; isPublicHoliday: PublicHoliday | null }> = {}
    if (!data || !data.installers) return map

    const holidayByDate: Record<string, PublicHoliday> = {}
    for (const h of (data.public_holidays || [])) holidayByDate[h.date] = h

    // Index assignments by user → set of visit_ids
    const assignmentsByUser: Record<string, Set<string>> = {}
    for (const a of data.assignments) {
      if (!assignmentsByUser[a.user_id]) assignmentsByUser[a.user_id] = new Set()
      assignmentsByUser[a.user_id].add(a.visit_id)
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

        const visitIds = assignmentsByUser[installer.id] || new Set()
        const cellVisits: Visit[] = []
        for (const vid of visitIds) {
          const v = visitById[vid]
          if (!v) continue
          // Visit covers this date if it has started by this date and either
          // hasn't ended or ends on/after this date
          const visitStart = v.start_at.slice(0, 10)
          const visitEnd = v.end_at ? v.end_at.slice(0, 10) : null
          if (dateStr < visitStart) continue
          if (visitEnd && dateStr > visitEnd) continue
          // Filter out completed visits in the past so the grid stays useful
          cellVisits.push(v)
        }

        map[cellKey] = {
          visits: cellVisits,
          timeOff: timeOffByCell[cellKey] || null,
          isPublicHoliday: holidayByDate[dateStr] || null,
        }
      }
    }

    return map
  }, [data, weekDates])

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
                    return (
                      <td
                        key={dateStr}
                        className={`px-2 py-2 align-top ${
                          isWeekend ? "bg-gray-50/40" : ""
                        } ${cell?.isPublicHoliday ? "bg-amber-50/40" : ""}`}
                      >
                        <div className="flex flex-col gap-1 min-h-[40px]">
                          {/* Time off block (takes priority over visits visually) */}
                          {cell?.timeOff && (
                            <div className="bg-amber-100 border border-amber-200 rounded-md px-2 py-1 text-[11px] text-amber-800">
                              {TYPE_LABELS[cell.timeOff.type] || cell.timeOff.type}
                              {cell.timeOff.is_half_day ? " · ½" : ""}
                            </div>
                          )}
                          {/* Visit blocks */}
                          {!cell?.timeOff &&
                            cell?.visits.map((v) => (
                              <div
                                key={v.id}
                                className="bg-teal-50 border border-teal-200 rounded-md px-2 py-1 text-[11px] text-teal-800 truncate"
                                title={`${v.jobs?.name || "Job"}${v.jobs?.address ? " · " + v.jobs.address : ""}`}
                              >
                                {v.jobs?.name || "Job"}
                              </div>
                            ))}
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
        Reads from job_visits and visit_assignments. Drag-drop coming soon.
      </p>
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
