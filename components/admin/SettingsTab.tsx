"use client"
import { useState, useEffect } from "react"

export default function SettingsTab() {
  const [signOutTime, setSignOutTime] = useState("17:00")
  const [gracePeriod, setGracePeriod] = useState(60)
  const [geofenceRadius, setGeofenceRadius] = useState(150)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch("/api/admin/settings").then(r => r.json()).then(data => {
      const c = data.company || {}
      if (c.default_sign_out_time) setSignOutTime(c.default_sign_out_time.slice(0, 5))
      if (c.grace_period_minutes != null) setGracePeriod(c.grace_period_minutes)
      if (c.geofence_radius_metres != null) setGeofenceRadius(c.geofence_radius_metres)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  async function save() {
    setSaving(true); setSaved(false)
    await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ default_sign_out_time: signOutTime, grace_period_minutes: gracePeriod, geofence_radius_metres: geofenceRadius })
    })
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  if (loading) return <div className="text-center py-12 text-gray-400">Loading settings...</div>

  const inp = "w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-gray-900 placeholder-gray-400 focus:outline-none focus:border-teal-400 text-sm"

  return (
    <div className="space-y-6 max-w-xl">
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold">Time tracking settings</h3>
          <p className="text-sm text-gray-500 mt-1">These apply as defaults to all jobs. You can override the sign-out time per job.</p>
        </div>
        <div className="px-6 py-5 space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Default sign-out time</label>
            <input type="time" value={signOutTime} onChange={e => setSignOutTime(e.target.value)} className={inp} />
            <p className="text-xs text-gray-400 mt-1">Installers will receive reminders to sign out starting at this time</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Grace period (minutes)</label>
            <select value={gracePeriod} onChange={e => setGracePeriod(Number(e.target.value))} className={inp}>
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
              <option value={45}>45 minutes</option>
              <option value={60}>1 hour</option>
              <option value={90}>1.5 hours</option>
              <option value={120}>2 hours</option>
            </select>
            <p className="text-xs text-gray-400 mt-1">After sign-out time + grace period, hours are calculated to last on-site GPS location</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Geofence radius (metres)</label>
            <select value={geofenceRadius} onChange={e => setGeofenceRadius(Number(e.target.value))} className={inp}>
              <option value={50}>50m (strict)</option>
              <option value={100}>100m</option>
              <option value={150}>150m (recommended)</option>
              <option value={200}>200m</option>
              <option value={300}>300m (relaxed)</option>
              <option value={500}>500m</option>
            </select>
            <p className="text-xs text-gray-400 mt-1">Installers must be within this distance of the job site to sign in and out</p>
          </div>
          <div className="flex items-center gap-3 pt-2">
            <button onClick={save} disabled={saving} className="bg-teal-400 hover:bg-teal-500 text-white font-bold rounded-xl px-6 py-2.5 text-sm transition-colors disabled:opacity-50">
              {saving ? "Saving..." : "Save settings"}
            </button>
            {saved && <span className="text-sm text-teal-600 font-medium">Settings saved</span>}
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
          <p>5. If they don't sign out within the grace period, hours are automatically calculated to their last on-site GPS location</p>
          <p>6. Early departures are flagged on the Performance dashboard</p>
        </div>
      </div>
    </div>
  )
}