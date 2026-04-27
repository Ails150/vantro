"use client"
import { useState, useEffect } from "react"

export default function SettingsTab() {
  const [gracePeriod, setGracePeriod] = useState(60)
  const [geofenceRadius, setGeofenceRadius] = useState(150)
  const [backgroundGps, setBackgroundGps] = useState(true)
  const [sickAutoApprove, setSickAutoApprove] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/admin/settings")
      .then((r) => r.json())
      .then((data) => {
        const c = data.company || {}
        if (c.grace_period_minutes != null) setGracePeriod(c.grace_period_minutes)
        if (c.geofence_radius_metres != null)
          setGeofenceRadius(c.geofence_radius_metres)
        if (c.background_gps_enabled != null)
          setBackgroundGps(c.background_gps_enabled)
        if (c.sick_auto_approve != null) setSickAutoApprove(c.sick_auto_approve)
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
        grace_period_minutes: gracePeriod,
        geofence_radius_metres: geofenceRadius,
        background_gps_enabled: backgroundGps,
        sick_auto_approve: sickAutoApprove,
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
    return <div className="text-center py-12 text-gray-400">Loading settings...</div>

  const inp =
    "w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-gray-900 placeholder-gray-400 focus:outline-none focus:border-teal-400 text-sm"

  return (
    <div className="space-y-6 max-w-xl">
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold">Site rules</h3>
          <p className="text-sm text-gray-500 mt-1">
            Working hours, overrides and time off live in the Scheduler tab.
          </p>
        </div>
        <div className="px-6 py-5 space-y-5">
          <div>
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
              After sign-out time + grace period, hours are calculated to the
              last on-site GPS location.
            </p>
          </div>

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
              Installers must be within this distance of the job site to sign
              in and out.
            </p>
          </div>

          <div className="flex items-start justify-between gap-4 pt-2 border-t border-gray-100">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700">
                Background GPS tracking
              </label>
              <p className="text-xs text-gray-400 mt-1">
                Log GPS breadcrumbs every 30 minutes while signed in, even when
                the app is in the background. Required for full compliance trail.
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

          <div className="flex items-start justify-between gap-4 pt-2 border-t border-gray-100">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700">
                Auto-approve sick leave
              </label>
              <p className="text-xs text-gray-400 mt-1">
                When on, installers' same-day sick requests are approved
                immediately and admins can review later. When off, every
                request goes to the approval queue.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSickAutoApprove(!sickAutoApprove)}
              className={
                "relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors " +
                (sickAutoApprove ? "bg-teal-400" : "bg-gray-200")
              }
              aria-pressed={sickAutoApprove}
              aria-label="Toggle auto-approve sick leave"
            >
              <span
                className={
                  "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform " +
                  (sickAutoApprove ? "translate-x-6" : "translate-x-1")
                }
              />
            </button>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={save}
              disabled={saving}
              className="bg-teal-400 hover:bg-teal-500 text-white font-bold rounded-xl px-6 py-2.5 text-sm transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save settings"}
            </button>
            {saved && (
              <span className="text-sm text-teal-600 font-medium">
                Settings saved
              </span>
            )}
            {error && <span className="text-sm text-red-500">{error}</span>}
          </div>
        </div>
      </div>
    </div>
  )
}
