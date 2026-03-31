Set-Location C:\vantro

# ═══════════════════════════════════════════════════════
# STEP 1: Add columns to alerts table in Supabase
# ═══════════════════════════════════════════════════════
Write-Host ""
Write-Host "=== RUN THIS SQL IN SUPABASE FIRST ===" -ForegroundColor Cyan
Write-Host @"
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id);
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES users(id);
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS resolution_note text;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS status text DEFAULT 'open';
"@ -ForegroundColor White
Write-Host ""
Read-Host "Press Enter once you have run the SQL in Supabase"

# ═══════════════════════════════════════════════════════
# STEP 2: Update diary route to save user_id on alert
# ═══════════════════════════════════════════════════════
$diary = Get-Content "C:\vantro\app\api\diary\route.ts" -Raw -Encoding UTF8
$diary = $diary.Replace(
  'await service.from("alerts").insert({
      company_id: resolvedCompanyId,
      job_id: jobId,
      message: (aiAlertType === "blocker" ? "BLOCKER" : "ISSUE") + " - " + (aiSummary || entryText.slice(0, 100)),
      alert_type: aiAlertType,
      is_read: false
    })',
  'await service.from("alerts").insert({
      company_id: resolvedCompanyId,
      job_id: jobId,
      user_id: resolvedUserId,
      message: (aiAlertType === "blocker" ? "BLOCKER" : "ISSUE") + " - " + (aiSummary || entryText.slice(0, 100)),
      alert_type: aiAlertType,
      is_read: false,
      status: "open"
    })'
)
[System.IO.File]::WriteAllText("C:\vantro\app\api\diary\route.ts", $diary, [System.Text.UTF8Encoding]::new($false))
Write-Host "Diary route updated to save user_id on alert" -ForegroundColor Green

# ═══════════════════════════════════════════════════════
# STEP 3: Create alerts resolve API route
# ═══════════════════════════════════════════════════════
New-Item -ItemType Directory -Force -Path "app\api\alerts" | Out-Null

$alertsRoute = @'
import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const service = await createServiceClient()
  const { data: adminUser } = await service.from("users")
    .select("id, company_id, name, role")
    .eq("auth_user_id", user.id)
    .single()

  if (!adminUser || !["admin", "foreman"].includes(adminUser.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { alertId, resolutionNote } = await request.json()
  if (!alertId || !resolutionNote?.trim()) {
    return NextResponse.json({ error: "Alert ID and resolution note required" }, { status: 400 })
  }

  // Get the alert with user info
  const { data: alert } = await service.from("alerts")
    .select("*, jobs(name), users(name, push_token, email)")
    .eq("id", alertId)
    .eq("company_id", adminUser.company_id)
    .single()

  if (!alert) return NextResponse.json({ error: "Alert not found" }, { status: 404 })

  // Mark as resolved
  await service.from("alerts").update({
    is_read: true,
    status: "resolved",
    resolved_at: new Date().toISOString(),
    resolved_by: adminUser.id,
    resolution_note: resolutionNote.trim()
  }).eq("id", alertId)

  const installer = alert.users as any
  const job = alert.jobs as any

  // Push notification to installer
  if (installer?.push_token) {
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: installer.push_token,
        sound: "default",
        title: "Alert resolved - " + (job?.name || "Job"),
        body: adminUser.name + ": " + resolutionNote.trim(),
        data: { type: "alert_resolved", alertId },
        channelId: "vantro",
      })
    }).catch(() => {})
  }

  // Email to installer
  if (installer?.email && process.env.RESEND_API_KEY) {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Vantro <alerts@getvantro.com>",
        to: installer.email,
        subject: "Alert resolved - " + (job?.name || "Job"),
        html: "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto\"><div style=\"background:#00C896;padding:20px;border-radius:8px 8px 0 0\"><h2 style=\"color:white;margin:0\">Alert Resolved</h2></div><div style=\"padding:24px;background:#f9f9f9;border-radius:0 0 8px 8px\"><p><strong>Job:</strong> " + (job?.name || "Unknown") + "</p><p><strong>Original alert:</strong> " + alert.message + "</p><p><strong>Resolution from " + adminUser.name + ":</strong> " + resolutionNote + "</p></div></div>"
      })
    }).catch(() => {})
  }

  return NextResponse.json({ success: true })
}
'@

[System.IO.File]::WriteAllText("C:\vantro\app\api\alerts\route.ts", $alertsRoute, [System.Text.UTF8Encoding]::new($false))
Write-Host "Alerts resolve API route created" -ForegroundColor Green

# ═══════════════════════════════════════════════════════
# STEP 4: Update AdminDashboard alerts tab
# Replace "Dismiss" with "Resolve" + resolution note input
# ═══════════════════════════════════════════════════════
$dash = Get-Content "C:\vantro\components\admin\AdminDashboard.tsx" -Raw -Encoding UTF8

# Add resolving state
$dash = $dash.Replace(
  '  const [saving, setSaving] = useState(false)',
  '  const [saving, setSaving] = useState(false)
  const [resolvingAlert, setResolvingAlert] = useState<string|null>(null)
  const [resolutionNote, setResolutionNote] = useState("")'
)

# Add resolveAlert function
$dash = $dash.Replace(
  '  async function markAlertRead(id: string) { await supabase.from("alerts").update({ is_read: true }).eq("id", id); router.refresh() }',
  '  async function markAlertRead(id: string) { await supabase.from("alerts").update({ is_read: true }).eq("id", id); router.refresh() }

  async function resolveAlert(id: string) {
    if (!resolutionNote.trim()) { alert("Please enter a resolution note"); return }
    setSaving(true)
    await fetch("/api/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alertId: id, resolutionNote })
    })
    setResolvingAlert(null)
    setResolutionNote("")
    setSaving(false)
    router.refresh()
  }'
)

# Replace alerts tab display - swap Dismiss for Resolve with note
$dash = $dash.Replace(
  '                  <button onClick={() => markAlertRead(a.id)} className={"text-sm " + sub + " hover:text-gray-900 border border-gray-200 rounded-lg px-3 py-1.5 flex-shrink-0"}>Dismiss</button>',
  '                  <button onClick={() => { setResolvingAlert(resolvingAlert === a.id ? null : a.id); setResolutionNote("") }} className="text-sm bg-teal-50 text-teal-600 border border-teal-200 hover:bg-teal-100 rounded-lg px-3 py-1.5 flex-shrink-0 font-medium">Resolve</button>'
)

# Add resolution note input below each alert
$dash = $dash.Replace(
  '              </div>
            ))}',
  '              {resolvingAlert === a.id && (
                  <div className="mt-3 flex gap-2">
                    <input
                      value={resolutionNote}
                      onChange={e => setResolutionNote(e.target.value)}
                      placeholder="Enter resolution note — this will be sent to the installer..."
                      className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-400"
                      onKeyDown={e => e.key === "Enter" && resolveAlert(a.id)}
                    />
                    <button onClick={() => resolveAlert(a.id)} disabled={saving} className="bg-teal-400 hover:bg-teal-500 text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
                      {saving ? "Sending..." : "Send & resolve"}
                    </button>
                  </div>
                )}
              </div>
            ))}'
)

[System.IO.File]::WriteAllText("C:\vantro\components\admin\AdminDashboard.tsx", $dash, [System.Text.UTF8Encoding]::new($false))
Write-Host "AdminDashboard alerts updated - Resolve replaces Dismiss" -ForegroundColor Green

git add app\api\alerts\route.ts app\api\diary\route.ts components\admin\AdminDashboard.tsx
git commit -m "Alerts: resolve with note, notify installer via push + email"
git push origin master
Write-Host "Pushed - Vercel will deploy" -ForegroundColor Cyan
