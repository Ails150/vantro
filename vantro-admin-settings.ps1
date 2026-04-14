Write-Host "=== VANTRO ADMIN SETTINGS + ASSIGN ALL ===" -ForegroundColor Cyan
Write-Host ""

# ─── 1. CREATE COMPANY SETTINGS API ─────────────────────────────────
New-Item -ItemType Directory -Force -Path "C:\vantro\app\api\admin\settings" | Out-Null
$settings = @'
import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const service = await createServiceClient()
  const { data: u } = await service.from("users").select("company_id, role").eq("auth_user_id", user.id).single()
  if (!u || u.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const { data: company } = await service.from("companies").select("id, name, default_sign_out_time, grace_period_minutes, geofence_radius_metres").eq("id", u.company_id).single()
  return NextResponse.json({ company: company || {} })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const service = await createServiceClient()
  const { data: u } = await service.from("users").select("company_id, role").eq("auth_user_id", user.id).single()
  if (!u || u.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const { default_sign_out_time, grace_period_minutes, geofence_radius_metres } = await request.json()
  const updates: any = {}
  if (default_sign_out_time !== undefined) updates.default_sign_out_time = default_sign_out_time
  if (grace_period_minutes !== undefined) updates.grace_period_minutes = grace_period_minutes
  if (geofence_radius_metres !== undefined) updates.geofence_radius_metres = geofence_radius_metres
  const { error } = await service.from("companies").update(updates).eq("id", u.company_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
'@
[System.IO.File]::WriteAllText("C:\vantro\app\api\admin\settings\route.ts", $settings, [System.Text.UTF8Encoding]::new($false))
Write-Host "1/3 Company settings API created" -ForegroundColor Green

# ─── 2. CREATE SettingsTab COMPONENT ─────────────────────────────────
$settingsTab = @'
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
'@
[System.IO.File]::WriteAllText("C:\vantro\components\admin\SettingsTab.tsx", $settingsTab, [System.Text.UTF8Encoding]::new($false))
Write-Host "2/3 SettingsTab component created" -ForegroundColor Green

# ─── 3. UPDATE AdminDashboard.tsx ────────────────────────────────────
$dashPath = "C:\vantro\components\admin\AdminDashboard.tsx"
$dash = [System.IO.File]::ReadAllText($dashPath, [System.Text.UTF8Encoding]::new($false))

# Add imports
if ($dash -notmatch "SettingsTab") {
  $dash = $dash -replace 'import ComplianceTab from "@/components/admin/ComplianceTab"', @"
import ComplianceTab from "@/components/admin/ComplianceTab"
import SettingsTab from "@/components/admin/SettingsTab"
"@
}

# Add sign-out time state variables
if ($dash -notmatch "jobSignOutTime") {
  $dash = $dash -replace '\[jobStartTime, setJobStartTime\] = useState\("08:00"\)', @"
[jobStartTime, setJobStartTime] = useState("08:00")
  const [jobSignOutTime, setJobSignOutTime] = useState("17:00")
  const [editJobSignOutTime, setEditJobSignOutTime] = useState("17:00")
  const [assigningAll, setAssigningAll] = useState(false)
"@
}

# Add Settings tab to tabs array
$dash = $dash -replace '\{ id: "defects", label: "Defects" \},', @"
{ id: "defects", label: "Defects" },
    { id: "settings", label: "Settings" },
"@

# Add sign-out time to add job form (after start time input)
$dash = $dash -replace '(<input type="time" value=\{jobStartTime\} onChange=\{e => setJobStartTime\(e\.target\.value\)\} className=\{inp\}/>)', @"
`$1
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">Sign-out time (expected finish)</label>
                  <input type="time" value={jobSignOutTime} onChange={e => setJobSignOutTime(e.target.value)} className={inp}/>
"@

# Add sign_out_time to the addJob insert
$dash = $dash -replace 'start_time: jobStartTime \}\)\.select\("id"\)', 'start_time: jobStartTime, sign_out_time: jobSignOutTime }).select("id")'

# Add sign-out time to edit job form (after status select)
$dash = $dash -replace '(<\/select>\s*<\/div>\s*<div>\s*<label className="block text-sm font-medium text-gray-600 mb-1">Checklists)', @"
</select>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-600 mb-1">Sign-out time</label>
                            <input type="time" value={editJobSignOutTime} onChange={e => setEditJobSignOutTime(e.target.value)} className={inp}/>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-600 mb-1">Checklists
"@

# Add sign_out_time to updateJob
$dash = $dash -replace 'start_time: editJobStartTime \}\)\.eq', 'start_time: editJobStartTime, sign_out_time: editJobSignOutTime }).eq'

# Add editJobSignOutTime init when clicking Edit
$dash = $dash -replace 'setEditJobPlaceSelected\(true\); setFormError\(""\)', 'setEditJobPlaceSelected(true); setEditJobSignOutTime(j.sign_out_time ? j.sign_out_time.slice(0, 5) : "17:00"); setFormError("")'

# Add "Assign all" button next to the individual assign buttons
$dash = $dash -replace '(<p className=\{"text-sm " \+ sub \+ " mb-3"\}>Click to assign or unassign<\/p>)', @"
<div className="flex items-center justify-between mb-3">
                            <p className={"text-sm " + sub}>Click to assign or unassign</p>
                            <button onClick={async () => { setAssigningAll(true); await fetch("/api/admin/assign-all", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: j.id }) }); setAssigningAll(false); window.location.reload() }} disabled={assigningAll} className="text-xs bg-teal-50 text-teal-600 border border-teal-200 hover:bg-teal-100 rounded-lg px-3 py-1.5 font-medium disabled:opacity-50">{assigningAll ? "Assigning..." : "Assign all installers"}</button>
                          </div>
"@

# Add Settings tab render
if ($dash -notmatch 'activeTab === "settings"') {
  $dash = $dash -replace '(\{activeTab === "defects" && <DefectsTab />})', @"
`$1
        {activeTab === "settings" && <SettingsTab />}
"@
}

# Reset jobSignOutTime on save
$dash = $dash -replace 'setJobStartTime\("08:00"\)', 'setJobStartTime("08:00"); setJobSignOutTime("17:00")'

[System.IO.File]::WriteAllText($dashPath, $dash, [System.Text.UTF8Encoding]::new($false))
Write-Host "3/3 AdminDashboard updated (sign-out time, assign all, settings tab)" -ForegroundColor Green

# ─── COMMIT AND PUSH ────────────────────────────────────────────────
cd C:\vantro
git add .
git commit -m "Feature: Admin settings UI - sign-out time per job, grace period, geofence radius, assign all installers, settings tab"
git push origin master

Write-Host ""
Write-Host "=== DEPLOYED ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "New features:" -ForegroundColor Yellow
Write-Host "  - Settings tab: default sign-out time, grace period, geofence radius" -ForegroundColor White
Write-Host "  - Add/Edit job: sign-out time field (overrides company default)" -ForegroundColor White
Write-Host "  - Assign panel: 'Assign all installers' button" -ForegroundColor White
