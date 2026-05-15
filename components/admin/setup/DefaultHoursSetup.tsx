"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun"
type DayPattern = { enabled: boolean; start: string; end: string }
type Pattern = Record<DayKey, DayPattern>

const DEFAULT_PATTERN: Pattern = {
  mon: { enabled: true, start: "08:00", end: "17:00" },
  tue: { enabled: true, start: "08:00", end: "17:00" },
  wed: { enabled: true, start: "08:00", end: "17:00" },
  thu: { enabled: true, start: "08:00", end: "17:00" },
  fri: { enabled: true, start: "08:00", end: "17:00" },
  sat: { enabled: false, start: "08:00", end: "17:00" },
  sun: { enabled: false, start: "08:00", end: "17:00" },
}

const DAYS: { key: DayKey; label: string }[] = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
]

export default function DefaultHoursSetup({ teamCount }: { teamCount: number }) {
  const router = useRouter()
  const [pattern, setPattern] = useState<Pattern>(DEFAULT_PATTERN)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggle(day: DayKey) {
    setPattern(prev => ({ ...prev, [day]: { ...prev[day], enabled: !prev[day].enabled } }))
  }

  function updateTime(day: DayKey, field: "start" | "end", value: string) {
    setPattern(prev => ({ ...prev, [day]: { ...prev[day], [field]: value } }))
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/setup/default-hours", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pattern }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || "Save failed")
      }
      router.push("/admin/setup")
    } catch (e: any) {
      setError(e.message || "Save failed")
    }
    setSaving(false)
  }

  if (teamCount === 0) {
    return (
      <div className="min-h-screen bg-gray-50 px-4 py-12">
        <div className="max-w-2xl mx-auto bg-white border border-gray-200 rounded-2xl p-8 text-center">
          <p className="text-gray-700 mb-4">You need to add team members before setting their hours.</p>
          <button onClick={() => router.push("/admin/setup")} className="px-4 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-xl text-sm font-medium">
            Back to setup
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-12">
      <div className="max-w-xl mx-auto">
        <button onClick={() => router.push("/admin/setup")} className="text-sm text-gray-500 hover:text-gray-900 mb-2">
          ← Back to setup
        </button>
        <h1 className="text-2xl font-bold text-gray-900">Default working hours</h1>
        <p className="text-sm text-gray-600 mt-1 mb-6">
          Set the standard weekly schedule. This will apply to all {teamCount} active team member{teamCount !== 1 ? "s" : ""}. You can customise individual schedules later.
        </p>

        <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-2">
          {DAYS.map(d => {
            const p = pattern[d.key]
            return (
              <div
                key={d.key}
                className={
                  "grid grid-cols-[32px_100px_1fr] gap-3 items-center py-2 " +
                  (p.enabled ? "" : "opacity-60")
                }
              >
                <button
                  type="button"
                  onClick={() => toggle(d.key)}
                  className={
                    "relative inline-flex h-5 w-9 items-center rounded-full transition-colors " +
                    (p.enabled ? "bg-teal-400" : "bg-gray-300")
                  }
                >
                  <span
                    className={
                      "inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform " +
                      (p.enabled ? "translate-x-5" : "translate-x-0.5")
                    }
                  />
                </button>
                <span className={"text-sm " + (p.enabled ? "font-medium text-gray-900" : "text-gray-400")}>
                  {d.label}
                </span>
                {p.enabled ? (
                  <div className="flex items-center gap-2 text-sm">
                    <input
                      type="time"
                      value={p.start}
                      onChange={(e) => updateTime(d.key, "start", e.target.value)}
                      className="rounded-md px-2 py-1 border border-gray-200 bg-gray-50 focus:outline-none focus:border-teal-400"
                    />
                    <span className="text-gray-400">→</span>
                    <input
                      type="time"
                      value={p.end}
                      onChange={(e) => updateTime(d.key, "end", e.target.value)}
                      className="rounded-md px-2 py-1 border border-gray-200 bg-gray-50 focus:outline-none focus:border-teal-400"
                    />
                  </div>
                ) : (
                  <span className="text-sm text-gray-400 italic">Off</span>
                )}
              </div>
            )
          })}
        </div>

        {error && <div className="mt-4 text-sm text-red-600">{error}</div>}

        <div className="mt-6 flex items-center justify-between">
          <p className="text-xs text-gray-500">Applies to all {teamCount} team members</p>
          <button
            onClick={save}
            disabled={saving}
            className="px-6 py-2.5 bg-teal-500 hover:bg-teal-600 text-white font-medium rounded-xl disabled:opacity-50"
          >
            {saving ? "Saving..." : "Apply to all team"}
          </button>
        </div>
      </div>
    </div>
  )
}