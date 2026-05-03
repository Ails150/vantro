"use client"
import { useEffect, useState } from "react"

const DAYS = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" }
]

const DEFAULT_SCHEDULE = {
  mon: { enabled: true, start: "08:00", end: "17:00" },
  tue: { enabled: true, start: "08:00", end: "17:00" },
  wed: { enabled: true, start: "08:00", end: "17:00" },
  thu: { enabled: true, start: "08:00", end: "17:00" },
  fri: { enabled: true, start: "08:00", end: "17:00" },
  sat: { enabled: false },
  sun: { enabled: false }
}

export default function MemberSchedule({ member, onSave, onCancel }: { member: any, onSave: (schedule: any) => void, onCancel: () => void }) {
  const [schedule, setSchedule] = useState<any>(DEFAULT_SCHEDULE)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function loadSchedule() {
      try {
        const res = await fetch('/api/admin/team/schedule?userId=' + member.id)
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        // API returns weekly_pattern shape - merge over defaults so disabled days are still present
        const merged: any = { ...DEFAULT_SCHEDULE }
        for (const k of ["mon","tue","wed","thu","fri","sat","sun"]) {
          if (data?.weekly_pattern?.[k]) {
            merged[k] = data.weekly_pattern[k]
          }
        }
        setSchedule(merged)
      } catch (e) {
        console.error('[schedule] load failed', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadSchedule()
    return () => { cancelled = true }
  }, [member.id])

  function toggleDay(day: string) {
    setSchedule((prev: any) => ({
      ...prev,
      [day]: { ...prev[day], enabled: !prev[day].enabled }
    }))
  }

  function setTime(day: string, field: "start" | "end", value: string) {
    setSchedule((prev: any) => ({
      ...prev,
      [day]: { ...prev[day], [field]: value }
    }))
  }

  return (
    <div className="px-6 pb-5 pt-3 border-t border-gray-100 bg-gray-50">
      <p className="text-xs text-gray-500 mb-4">Set {member.name}'s working days and hours. GPS tracking window is 3 hours before sign-out.</p>
      <div className="space-y-2">
        {DAYS.map(d => (
          <div key={d.key} className="flex items-center gap-3">
            <button onClick={() => toggleDay(d.key)} className={"w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors " + (schedule[d.key]?.enabled ? "bg-teal-400 border-teal-400" : "bg-white border-gray-300")}>
              {schedule[d.key]?.enabled && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            </button>
            <span className={"text-sm w-24 " + (schedule[d.key]?.enabled ? "text-gray-700 font-medium" : "text-gray-400")}>{d.label}</span>
            {schedule[d.key]?.enabled ? (
              <div className="flex items-center gap-2">
                <input type="time" value={schedule[d.key]?.start || "08:00"} onChange={e => setTime(d.key, "start", e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm w-28" />
                <span className="text-gray-400 text-xs">to</span>
                <input type="time" value={schedule[d.key]?.end || "17:00"} onChange={e => setTime(d.key, "end", e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm w-28" />
              </div>
            ) : (
              <span className="text-xs text-gray-400 italic">Day off</span>
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-4">
        <button onClick={() => onSave(schedule)} className="bg-teal-400 text-white text-xs font-bold rounded-lg px-4 py-2">Save schedule</button>
        <button onClick={onCancel} className="border border-gray-200 text-gray-500 text-xs rounded-lg px-4 py-2">Cancel</button>
      </div>
    </div>
  )
}

