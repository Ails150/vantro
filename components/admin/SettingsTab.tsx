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

export default function SettingsTab() {
  const [schedule, setSchedule] = useState<WeeklySchedule>(DEFAULT_SCHEDULE)
  const [gracePeriod, setGracePeriod] = useState(60)
  const [geofenceRadius, setGeofenceRadius] = useState(150)
  const [backgroundGps, setBackgroundGps] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/admin/settings")
      .then((r) => r.json())
      .then((data) => {
        const c = data.company || {}
        if (c.default_schedule) {
          // Merge fetched schedule over defaults so any missing days fall back to defaults
          setSchedule({ ...DEFAULT_SCHEDULE, ...c.default_schedule })
        }
        if (c.grace_period_minutes != null) setGracePeriod(c.grace_period_minutes)
        if (c.geofence_radius_metres != null) setGeofenceRadius(c.geofence_radius_metres)
        if (c.background_gps_enabled != null) setBackgroundGps(c.background_gps_enabled)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  async function save() {
    setSaving(true)
    setSaved(false)
    setError(null)
    const res = await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        default_schedule: schedule,
        grace_period_minutes: gracePeriod,
        geofence_radius_metres: geofenceRadius,
        background_gps_enabled: backgroundGps,
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

  function toggleDay(day: keyof WeeklySchedule) {
    setSchedule((prev) => {
      const current = prev[day]
      if (current.enabled) {
        // Disable - keep times so they're not lost if re-enabled
        return { ...prev, [day]: { ...current, enabled: false } }
      } else {
        // Enable - restore last times or fall back to 8-5
        return {
          ...prev,
          [day]: {
            enabled: true,
            start: current.start || "08:00",
            end: current.end || "17:00",
          },
        }
      }
    })
  }

  function updateTime(day: keyof WeeklySchedule, field: "start" | "end", value: string) {
    setSchedule((prev) => ({
      ...prev,
      [day]: { ...prev[day], [field]: value },
    }))
  }

  if (loading)
    return <div className="text-center py-12 text-gray-400">Loading settings...</div>

  const inp =
    "w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-gray-900 placeholder-gray-400 focus:outline-none focus:border-teal-400 text-sm"
  const timeInp =
    "bg-white border border-gray-200 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:border-teal-400 text-sm"

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold">Time tracking settings</h3>
          <p className="text-sm text-gray-500 mt-1">
            These apply as defaults to all jobs. You can override the schedule per installer in
            the Team tab, or the sign-out time per job.
          </p>
        </div>
        <div className="px-6 py-5 space-y-5">
          {/* Per-day schedule */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Working days &amp; hours
            </label>
            <div className="space-y-2">
              {DAYS.map((d) => {
                const day = schedule[d.key]
                return (
                  <div
                    key={d.key}
                    className="flex items-center gap-3 py-2"
                  >
                    {/* Toggle */}
                    <button
                      type="button"
                      onClick={() => toggleDay(d.key)}
                      className={
                        "relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors " +
                        (day.enabled ? "bg-teal-400" : "bg-gray-200")
                      }
                      aria-pressed={day.enabled}
                      aria-label={`Toggle ${d.label}`}
                    >
                      <span
                        className={
                          "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform " +
                          (day.enabled ? "translate-x-6" : "translate-x-1")
                        }
                      />
                    </button>

                    {/* Day label */}
                    <span
                      className={
                        "w-24 text-sm font-medium " +
                        (day.enabled ? "text-gray-900" : "text-gray-400")
                      }
                    >
                      {d.label}
                    </span>

                    {/* Times */}
                    {day.enabled ? (
                      <div className="flex items-center gap-2 flex-1">
                        <input
                          type="time"
                          value={day.start || "08:00"}
                          onChange={(e) => updateTime(d.key, "start", e.target.value)}
                          className={timeInp}
                        />
                        <span className="text-gray-400 text-sm">to</span>
                        <input
                          type="time"
                          value={day.end || "17:00"}
                          onChange={(e) => updateTime(d.key, "end", e.target.value)}
                          className={timeInp}
                        />
                      </div>
                    ) : (
                      <span className="text-sm text-gray-400 italic">Off</span>
                    )}
                  </div>
                )
              })}
            </div>
            <p className="text-xs text-gray-400 mt-3">
              Set different hours per day if needed (e.g. shorter Friday). Override per person in
              the Team tab. Public holidays are skipped automatically.
            </p>
          </div>

          {/* Grace period */}
          <div className="pt-2 border-t border-gray-100">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Grace period (minutes)
            </label>
            <select
              value={gracePeriod}
              onChange={(e) => setGracePeriod(Number(e.target.value))}
              className={inp}
            >
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
              <option value={45}>45 minutes</option>
              <option value={60}>1 hour</option>
              <option value={90}>1.5 hours</option>
              <option value={120}>2 hours</option>
            </select>
            <p className="text-xs text-gray-400 mt-1">
              After sign-out time + grace period, hours are calculated to last on-site GPS
              location
            </p>
          </div>

          {/* Geofence */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Geofence radius (metres)
            </label>
            <select
              value={geofenceRadius}
              onChange={(e) => setGeofenceRadius(Number(e.target.value))}
              className={inp}
            >
              <option value={50}>50m (strict)</option>
              <option value={100}>100m</option>
              <option value={150}>150m (recommended)</option>
              <option value={200}>200m</option>
              <option value={300}>300m (relaxed)</option>
              <option value={500}>500m</option>
            </select>
            <p className="text-xs text-gray-400 mt-1">
              Installers must be within this distance of the job site to sign in and out
            </p>
          </div>

          {/* Background GPS */}
          <div className="flex items-start justify-between gap-4 pt-2 border-t border-gray-100">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700">
                Background GPS tracking
              </label>
              <p className="text-xs text-gray-400 mt-1">
                Log GPS breadcrumbs every 30 minutes while signed in, even when the app is in the
                background. Required for full compliance trail.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setBackgroundGps(!backgroundGps)}
              className={
                "relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors " +
                (backgroundGps ? "bg-teal-400" : "bg-gray-200")
              }
              aria-pressed={backgroundGps}
              aria-label="Toggle background GPS tracking"
            >
              <span
                className={
                  "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform " +
                  (backgroundGps ? "translate-x-6" : "translate-x-1")
                }
              />
            </button>
          </div>

          {/* Save */}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={save}
              disabled={saving}
              className="bg-teal-400 hover:bg-teal-500 text-white font-bold rounded-xl px-6 py-2.5 text-sm transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save settings"}
            </button>
            {saved && (
              <span className="text-sm text-teal-600 font-medium">Settings saved</span>
            )}
            {error && <span className="text-sm text-red-500 font-medium">{error}</span>}
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold">How it works</h3>
        </div>
        <div className="px-6 py-5 space-y-3 text-sm text-gray-600">
          <p>1. Installers sign in on site (GPS verified within geofence radius)</p>
          <p>2. GPS breadcrumbs are logged every 30 minutes while signed in</p>
          <p>3. At sign-out time, reminders are sent every 15 minutes</p>
          <p>4. Installers must return to site to sign out (GPS enforced)</p>
          <p>
            5. If they don't sign out within the grace period, hours are automatically calculated
            to their last on-site GPS location
          </p>
          <p>6. Early departures are flagged on the Performance dashboard</p>
          <p>7. Public holidays and approved time off skip compliance checks automatically</p>
        </div>
      </div>
    </div>
  )
}
