"use client"

import { useState, useEffect } from "react"

type DaySchedule = {
  enabled: boolean
  start?: string
  end?: string
}

type WeeklySchedule = {
  mon: DaySchedule
  tue: DaySchedule
  wed: DaySchedule
  thu: DaySchedule
  fri: DaySchedule
  sat: DaySchedule
  sun: DaySchedule
}

const DAYS: { key: keyof WeeklySchedule; label: string }[] = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
]

const DEFAULT_SCHEDULE: WeeklySchedule = {
  mon: { enabled: true, start: "08:00", end: "17:00" },
  tue: { enabled: true, start: "08:00", end: "17:00" },
  wed: { enabled: true, start: "08:00", end: "17:00" },
  thu: { enabled: true, start: "08:00", end: "17:00" },
  fri: { enabled: true, start: "08:00", end: "17:00" },
  sat: { enabled: false },
  sun: { enabled: false },
}

const TEMPLATES: { id: string; label: string; pattern: WeeklySchedule }[] = [
  { id: "monfri-8-5", label: "Mon–Fri 8–5", pattern: DEFAULT_SCHEDULE },
  {
    id: "monsat-7-4",
    label: "Mon–Sat 7–4",
    pattern: {
      mon: { enabled: true, start: "07:00", end: "16:00" },
      tue: { enabled: true, start: "07:00", end: "16:00" },
      wed: { enabled: true, start: "07:00", end: "16:00" },
      thu: { enabled: true, start: "07:00", end: "16:00" },
      fri: { enabled: true, start: "07:00", end: "16:00" },
      sat: { enabled: true, start: "07:00", end: "16:00" },
      sun: { enabled: false },
    },
  },
  {
    id: "monfri-9-6",
    label: "Mon–Fri 9–6",
    pattern: {
      mon: { enabled: true, start: "09:00", end: "18:00" },
      tue: { enabled: true, start: "09:00", end: "18:00" },
      wed: { enabled: true, start: "09:00", end: "18:00" },
      thu: { enabled: true, start: "09:00", end: "18:00" },
      fri: { enabled: true, start: "09:00", end: "18:00" },
      sat: { enabled: false },
      sun: { enabled: false },
    },
  },
]

const COMMON_TIMEZONES = [
  "Europe/London",
  "Europe/Dublin",
  "Europe/Belfast",
  "Europe/Paris",
  "Europe/Madrid",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Perth",
  "Pacific/Auckland",
  "UTC",
]

function patternsEqual(a: WeeklySchedule, b: WeeklySchedule) {
  for (const k of ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const) {
    const x = a[k]
    const y = b[k]
    if (!!x.enabled !== !!y.enabled) return false
    if (x.enabled) {
      if ((x.start || "") !== (y.start || "")) return false
      if ((x.end || "") !== (y.end || "")) return false
    }
  }
  return true
}

export default function DefaultsTab() {
  const [schedule, setSchedule] = useState<WeeklySchedule>(DEFAULT_SCHEDULE)
  const [countryCode, setCountryCode] = useState("GB")
  const [timezone, setTimezone] = useState("Europe/London")
  // leave_year_picker_v1
  const [leaveYearMode, setLeaveYearMode] = useState<"country" | "calendar" | "custom">("country")
  const [leaveYearMonth, setLeaveYearMonth] = useState<number>(1)
  const [leaveYearDay, setLeaveYearDay] = useState<number>(1)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [overrideCount, setOverrideCount] = useState<number | null>(null)
  const [teamSize, setTeamSize] = useState<number | null>(null)

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/settings").then((r) => r.json()),
      fetch("/api/admin/team-schedules").then((r) => r.json()),
    ])
      .then(([settingsData, teamData]) => {
        const c = settingsData?.company || {}
        if (c.default_schedule) {
          setSchedule({ ...DEFAULT_SCHEDULE, ...c.default_schedule })
        }
        if (c.country_code) setCountryCode(c.country_code)
        if (c.timezone) setTimezone(c.timezone)
        // leave_year_picker_v1
        if (c.leave_year_start_month != null && c.leave_year_start_day != null) {
          if (c.leave_year_start_month === 1 && c.leave_year_start_day === 1) {
            setLeaveYearMode("calendar")
          } else {
            setLeaveYearMode("custom")
          }
          setLeaveYearMonth(c.leave_year_start_month)
          setLeaveYearDay(c.leave_year_start_day)
        } else {
          setLeaveYearMode("country")
        }
        if (teamData?.counts) {
          setOverrideCount(teamData.counts.custom)
          setTeamSize(teamData.counts.total)
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  function applyTemplate(t: WeeklySchedule) {
    setSchedule(t)
  }

  function toggleDay(day: keyof WeeklySchedule) {
    setSchedule((prev) => {
      const current = prev[day]
      if (current.enabled) return { ...prev, [day]: { ...current, enabled: false } }
      return {
        ...prev,
        [day]: {
          enabled: true,
          start: current.start || "08:00",
          end: current.end || "17:00",
        },
      }
    })
  }

  function updateTime(day: keyof WeeklySchedule, field: "start" | "end", value: string) {
    setSchedule((prev) => ({ ...prev, [day]: { ...prev[day], [field]: value } }))
  }

  async function save() {
    setSaving(true)
    setSaved(false)
    setError(null)

    const cleanCountry = (countryCode || "").trim().toUpperCase()
    if (cleanCountry && !/^[A-Z]{2}$/.test(cleanCountry)) {
      setSaving(false)
      setError("Country must be a 2-letter ISO code (e.g. GB, IE, US, AU)")
      return
    }

    const res = await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        default_schedule: schedule,
        country_code: cleanCountry || "GB",
        timezone: timezone || "Europe/London",
      }),
    })
    setSaving(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error || `Save failed (${res.status})`)
      return
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  if (loading)
    return <div className="text-center py-12 text-gray-400">Loading defaults...</div>

  const totalMinutes = (Object.values(schedule) as DaySchedule[]).reduce((acc, d) => {
    if (!d.enabled || !d.start || !d.end) return acc
    const [sh, sm] = d.start.split(":").map(Number)
    const [eh, em] = d.end.split(":").map(Number)
    return acc + (eh * 60 + em - (sh * 60 + sm))
  }, 0)
  const totalHours = Math.round((totalMinutes / 60) * 10) / 10

  return (
    <div className="space-y-3 max-w-2xl">
      {/* Location card */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5">
        <div className="text-sm font-medium mb-1">Location</div>
        <div className="text-xs text-gray-500 mb-4">
          Drives public holidays, default holiday entitlement and time formatting.
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Country (ISO 2-letter)</label>
            <input
              type="text"
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value.toUpperCase().slice(0, 2))}
              maxLength={2}
              placeholder="GB"
              className="w-full bg-white border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-teal-400 uppercase"
            />
            <div className="text-[11px] text-gray-400 mt-1">
              GB, IE, US, AU supported with public holidays. Other codes accepted but no holidays loaded.
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Timezone</label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full bg-white border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-teal-400"
            >
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Quick start */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5">
        <div className="text-xs text-gray-500 mb-3">Quick start</div>
        <div className="flex gap-2 flex-wrap">
          {TEMPLATES.map((t) => {
            const active = patternsEqual(schedule, t.pattern)
            return (
              <button
                key={t.id}
                onClick={() => applyTemplate(t.pattern)}
                className={
                  "px-4 py-2 rounded-xl text-sm font-medium transition-colors " +
                  (active
                    ? "bg-teal-400 text-white"
                    : "bg-white border border-gray-200 hover:border-teal-300")
                }
              >
                {t.label}
                {active ? " ✓" : ""}
              </button>
            )
          })}
        </div>
      </div>

      {/* Per-day list */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 text-xs text-gray-500 flex items-center justify-between">
          <span>Working pattern</span>
          <span>{totalHours} hours/week</span>
        </div>
        {DAYS.map((d) => {
          const day = schedule[d.key]
          const isEdited =
            !patternsEqual(schedule, DEFAULT_SCHEDULE) &&
            (day.enabled !== DEFAULT_SCHEDULE[d.key].enabled ||
              (day.enabled &&
                (day.start !== DEFAULT_SCHEDULE[d.key].start ||
                  day.end !== DEFAULT_SCHEDULE[d.key].end)))
          return (
            <div
              key={d.key}
              className={
                "grid grid-cols-[32px_90px_1fr_auto] gap-3 items-center px-5 py-2.5 " +
                (isEdited
                  ? "bg-amber-50 border-b border-gray-100 last:border-0"
                  : day.enabled
                  ? "border-b border-gray-100 last:border-0"
                  : "opacity-60 border-b border-gray-100 last:border-0")
              }
            >
              <button
                type="button"
                onClick={() => toggleDay(d.key)}
                className={
                  "relative inline-flex h-5 w-9 items-center rounded-full transition-colors " +
                  (day.enabled ? "bg-teal-400" : "bg-gray-300")
                }
              >
                <span
                  className={
                    "inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform " +
                    (day.enabled ? "translate-x-5" : "translate-x-0.5")
                  }
                />
              </button>
              <span
                className={
                  "text-sm " +
                  (day.enabled ? "text-gray-900 font-medium" : "text-gray-400")
                }
              >
                {d.label}
              </span>
              {day.enabled ? (
                <div className="flex items-center gap-2 text-sm">
                  <input
                    type="time"
                    value={day.start || "08:00"}
                    onChange={(e) => updateTime(d.key, "start", e.target.value)}
                    className={
                      "rounded-md px-2 py-1 border focus:outline-none focus:border-teal-400 " +
                      (isEdited
                        ? "bg-amber-100 border-amber-300 font-medium"
                        : "bg-gray-50 border-gray-200")
                    }
                  />
                  <span className="text-gray-400">→</span>
                  <input
                    type="time"
                    value={day.end || "17:00"}
                    onChange={(e) => updateTime(d.key, "end", e.target.value)}
                    className={
                      "rounded-md px-2 py-1 border focus:outline-none focus:border-teal-400 " +
                      (isEdited
                        ? "bg-amber-100 border-amber-300 font-medium"
                        : "bg-gray-50 border-gray-200")
                    }
                  />
                </div>
              ) : (
                <span className="text-sm text-gray-400 italic">Off</span>
              )}
              <span
                className={"text-xs " + (isEdited ? "text-amber-700" : "text-gray-400")}
              >
                {isEdited ? "Edited" : "Regular"}
              </span>
            </div>
          )
        })}
      </div>

      {/* Save row */}
      <div className="flex items-center justify-between px-1">
        <div className="text-xs text-gray-500">
          {overrideCount !== null && teamSize !== null
            ? `${overrideCount} of ${teamSize} installers have personal overrides — they ignore the default`
            : ""}
        </div>
        <div className="flex items-center gap-3">
          {saved && <span className="text-sm text-teal-600 font-medium">Saved</span>}
          {error && <span className="text-sm text-red-500">{error}</span>}
          <button
            onClick={save}
            disabled={saving}
            className="bg-teal-400 hover:bg-teal-500 text-white font-medium rounded-xl px-5 py-2 text-sm disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save defaults"}
          </button>
        </div>
      </div>
    </div>
  )
}
