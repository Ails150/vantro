Set-Location C:\vantro

# ═══════════════════════════════════════════════════════
# VERIFY diary route has installer token support
# ═══════════════════════════════════════════════════════
$check = Select-String -Path "C:\vantro\app\api\diary\route.ts" -Pattern "getInstallerFromToken" -Quiet
if (-not $check) {
  Write-Host "Diary route missing installer token support - fixing now" -ForegroundColor Red
  
  $diaryRoute = @'
import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"
import Anthropic from "@anthropic-ai/sdk"

function getInstallerFromToken(request: Request) {
  const auth = request.headers.get("authorization")
  if (!auth?.startsWith("Bearer ")) return null
  try {
    const payload = JSON.parse(Buffer.from(auth.slice(7), "base64").toString())
    if (payload.exp < Date.now()) return null
    return payload
  } catch { return null }
}

export async function POST(request: Request) {
  const service = await createServiceClient()
  const body = await request.json()
  const { jobId, entryText } = body

  let resolvedUserId: string
  let resolvedCompanyId: string

  const auth = request.headers.get("authorization")
  if (auth?.startsWith("Bearer ")) {
    const installer = getInstallerFromToken(request)
    if (!installer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    resolvedUserId = installer.userId
    resolvedCompanyId = installer.companyId
  } else {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { data: u } = await service.from("users").select("id, company_id").eq("auth_user_id", user.id).single()
    if (!u) return NextResponse.json({ error: "User not found" }, { status: 404 })
    resolvedUserId = u.id
    resolvedCompanyId = u.company_id
  }

  let aiAlertType = null
  let aiSummary = null

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const completion = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [{ role: "user", content: "You are a construction site supervisor AI. Analyse this site diary entry and classify it. Reply with JSON only - no other text: {\"alert_type\": \"blocker\"|\"issue\"|\"none\", \"summary\": \"one sentence max 15 words\"}.\n\nBLOCKER = work cannot continue today. Examples: no workers on site, missing materials, access denied, safety hazard, waiting for delivery, nobody turned up.\nISSUE = problem that needs attention but work can continue. Examples: minor delay, quality concern, one person missing.\nNONE = normal progress update.\n\nEntry: " + entryText }]
    })
    const parsed = JSON.parse(completion.content[0].type === "text" ? completion.content[0].text : "{}")
    aiAlertType = parsed.alert_type || null
    aiSummary = parsed.summary || null
  } catch(e) {}

  const { data: entry } = await service.from("diary_entries").insert({
    job_id: jobId,
    company_id: resolvedCompanyId,
    user_id: resolvedUserId,
    entry_text: entryText,
    ai_alert_type: aiAlertType,
    ai_summary: aiSummary
  }).select().single()

  if (aiAlertType && aiAlertType !== "none") {
    const { data: job } = await service.from("jobs").select("name").eq("id", jobId).single()
    const { data: alertUser } = await service.from("users").select("name").eq("id", resolvedUserId).single()

    await service.from("alerts").insert({
      company_id: resolvedCompanyId,
      job_id: jobId,
      message: (aiAlertType === "blocker" ? "BLOCKER" : "ISSUE") + " - " + (aiSummary || entryText.slice(0, 100)),
      alert_type: aiAlertType,
      is_read: false
    })

    // Push notify admin and foreman
    const { data: admins } = await service.from("users")
      .select("push_token, name, email")
      .eq("company_id", resolvedCompanyId)
      .in("role", ["admin", "foreman"])

    const tokens = (admins || []).map((a: any) => a.push_token).filter(Boolean)
    if (tokens.length > 0) {
      await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tokens.map((token: string) => ({
          to: token,
          sound: "default",
          title: aiAlertType === "blocker" ? "BLOCKER on site" : "Issue flagged",
          body: (job?.name || "Job") + ": " + (aiSummary || entryText.slice(0, 80)),
          data: { type: "diary_alert", jobId, alertType: aiAlertType },
          channelId: "vantro",
        })))
      }).catch(() => {})
    }

    // Email admin and foreman
    if (process.env.RESEND_API_KEY) {
      const emailRecipients = (admins || []).filter((r: any) => r.email)
      for (const recipient of emailRecipients) {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: "Vantro Alerts <alerts@getvantro.com>",
            to: recipient.email,
            subject: (aiAlertType === "blocker" ? "BLOCKER" : "ISSUE") + " - " + (job?.name || "Job"),
            html: "<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto\"><div style=\"background:" + (aiAlertType === "blocker" ? "#dc2626" : "#d97706") + ";padding:20px;border-radius:8px 8px 0 0\"><h2 style=\"color:white;margin:0\">" + (aiAlertType === "blocker" ? "BLOCKER" : "ISSUE") + " — Vantro Alert</h2></div><div style=\"padding:24px;background:#f9f9f9;border-radius:0 0 8px 8px\"><p><strong>Job:</strong> " + (job?.name || "Unknown") + "</p><p><strong>Logged by:</strong> " + (alertUser?.name || "Unknown") + "</p><p><strong>Summary:</strong> " + (aiSummary || entryText) + "</p><a href=\"https://app.getvantro.com/admin\" style=\"display:inline-block;margin-top:16px;padding:12px 24px;background:#00C896;color:white;border-radius:8px;text-decoration:none;font-weight:bold\">View Dashboard</a></div></div>"
          })
        }).catch(() => {})
      }
    }
  }

  return NextResponse.json({ success: true, entry, aiAlertType, aiSummary })
}
'@

  [System.IO.File]::WriteAllText("C:\vantro\app\api\diary\route.ts", $diaryRoute, [System.Text.UTF8Encoding]::new($false))
  Write-Host "Diary route fixed" -ForegroundColor Green
} else {
  Write-Host "Diary route already has installer token support" -ForegroundColor Green
}

git add app\api\diary\route.ts
git diff --cached --stat
git commit -m "Fix diary route - installer token, AI alerts, push + email notifications"
git push origin master
Write-Host "Pushed" -ForegroundColor Cyan

# ═══════════════════════════════════════════════════════
# ADD MAPS TO INSTALLER JOB SCREEN
# ═══════════════════════════════════════════════════════
Set-Location C:\vantro-mobile

# Add a Get Directions button to jobs.tsx that opens native maps
$jobs = Get-Content "C:\vantro-mobile\app\(installer)\jobs.tsx" -Raw -Encoding UTF8

# Add Linking import
if ($jobs -notmatch "Linking") {
  $jobs = $jobs.Replace(
    "import { View, Text, ScrollView, TouchableOpacity,`n  StyleSheet, SafeAreaView, RefreshControl, Alert,`n} from 'react-native';",
    "import { View, Text, ScrollView, TouchableOpacity,`n  StyleSheet, SafeAreaView, RefreshControl, Alert, Linking,`n} from 'react-native';"
  )
}

# Add openMaps function after signOut function
$jobs = $jobs.Replace(
  "  const signedInJob = jobs.find(j => j.signed_in);",
  "  function openMaps(job: any) {
    const address = encodeURIComponent(job.address || '');
    const latLng = job.lat && job.lng ? `${job.lat},${job.lng}` : null;
    const url = latLng
      ? `https://www.google.com/maps/dir/?api=1&destination=${latLng}`
      : `https://www.google.com/maps/search/?api=1&query=${address}`;
    Linking.openURL(url).catch(() => {
      Linking.openURL(`maps:?q=${address}`).catch(() => Alert.alert('Maps not available'));
    });
  }

  const signedInJob = jobs.find(j => j.signed_in);"
)

# Add directions button to job card (before sign in button)
$jobs = $jobs.Replace(
  "              {!job.signed_in ? (",
  "              <TouchableOpacity style={s.directionsBtn} onPress={() => openMaps(job)}>
                <Text style={s.directionsBtnText}>Get directions</Text>
              </TouchableOpacity>

              {!job.signed_in ? ("
)

# Add directions button style
$jobs = $jobs.Replace(
  "  actionBtnTextRed: { color: C.red },",
  "  actionBtnTextRed: { color: C.red },
  directionsBtn: { backgroundColor: 'rgba(96,165,250,0.08)', borderRadius: 10, paddingVertical: 8, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(96,165,250,0.2)', marginBottom: 8 },
  directionsBtnText: { fontSize: 13, color: '#60a5fa', fontWeight: '500' },"
)

[System.IO.File]::WriteAllText("C:\vantro-mobile\app\(installer)\jobs.tsx", $jobs, [System.Text.UTF8Encoding]::new($false))
Write-Host "Maps directions button added to jobs screen" -ForegroundColor Green

git add "app/(installer)/jobs.tsx"
git commit -m "Add Get Directions button to job cards - opens Google Maps"
eas build --platform android --profile preview
Write-Host "Build submitted" -ForegroundColor Cyan
