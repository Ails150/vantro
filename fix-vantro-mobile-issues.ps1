Set-Location C:\vantro

# ═══════════════════════════════════════════════════════════════
# FIX 1: Diary API - accept installer Bearer token
# ═══════════════════════════════════════════════════════════════
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
      messages: [{ role: "user", content: "Analyse this site diary entry. Reply with JSON only: {\"alert_type\": \"blocker\"|\"issue\"|\"none\", \"summary\": \"one sentence\"}. Entry: " + entryText }]
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

    const { data: recipients } = await service.from("users").select("email, name").eq("company_id", resolvedCompanyId).in("role", ["admin", "foreman"])
    if (recipients && recipients.length > 0 && process.env.RESEND_API_KEY) {
      for (const recipient of recipients.filter((r: any) => r.email)) {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: "Vantro Alerts <alerts@getvantro.com>",
            to: recipient.email,
            subject: (aiAlertType === "blocker" ? "BLOCKER" : "ISSUE") + " - " + (job?.name || "Job"),
            html: "<div style=\"font-family:sans-serif\"><h2>Vantro Alert</h2><p><strong>" + (aiAlertType === "blocker" ? "BLOCKER" : "ISSUE") + "</strong></p><p>Job: " + (job?.name || "Unknown") + "</p><p>By: " + (alertUser?.name || "Unknown") + "</p><p>" + (aiSummary || entryText) + "</p><a href=\"https://app.getvantro.com/admin\">View Dashboard</a></div>"
          })
        }).catch(() => {})
      }
    }
  }

  return NextResponse.json({ success: true, entry })
}
'@

[System.IO.File]::WriteAllText("C:\vantro\app\api\diary\route.ts", $diaryRoute, [System.Text.UTF8Encoding]::new($false))
Write-Host "Diary API fixed" -ForegroundColor Green

git add app\api\diary\route.ts
git commit -m "Fix diary API to accept installer Bearer token"
git push origin master

Write-Host "Pushed to GitHub" -ForegroundColor Cyan

# ═══════════════════════════════════════════════════════════════
# FIX 2: Mobile app - fix emoji encoding + add QA submit button
# ═══════════════════════════════════════════════════════════════
Set-Location C:\vantro-mobile

# Fix jobs.tsx - replace emoji strings with plain text to avoid encoding issues
$jobs = Get-Content "C:\vantro-mobile\app\(installer)\jobs.tsx" -Raw -Encoding UTF8
$jobs = $jobs.Replace('"📋 Diary"', '"Diary"')
$jobs = $jobs.Replace('"✓ QA"', '"QA"')
$jobs = $jobs.Replace('"⚠ Defects"', '"Defects"')
[System.IO.File]::WriteAllText("C:\vantro-mobile\app\(installer)\jobs.tsx", $jobs, [System.Text.UTF8Encoding]::new($false))
Write-Host "Emoji encoding fixed in jobs.tsx" -ForegroundColor Green

# Fix diary.tsx - the submit button text colour was wrong (dark text on dark bg)
$diary = Get-Content "C:\vantro-mobile\app\(installer)\diary.tsx" -Raw -Encoding UTF8
$diary = $diary.Replace(
  'submitBtnText: { fontSize: 14, fontWeight: "600", color: "#0f1923" }',
  'submitBtnText: { fontSize: 14, fontWeight: "600", color: "#0f1923" },
  submitBtnSuccessText: { color: "#00d4a0" }'
)
# Fix the submit button text color in success state
$diary = $diary.Replace(
  '<Text style={s.submitBtnText}>{success ? ''Submitted ' + [char]0x2713 + ''' : loading ? ''Submitting...'' : ''Submit entry''}</Text>',
  '<Text style={[s.submitBtnText, success && { color: "#00d4a0" }]}>{success ? "Submitted" : loading ? "Submitting..." : "Submit entry"}</Text>'
)
[System.IO.File]::WriteAllText("C:\vantro-mobile\app\(installer)\diary.tsx", $diary, [System.Text.UTF8Encoding]::new($false))
Write-Host "Diary submit button fixed" -ForegroundColor Green

# Add QA submit for approval button to qa.tsx
$qa = Get-Content "C:\vantro-mobile\app\(installer)\qa.tsx" -Raw -Encoding UTF8

# Add submitForApproval function and button
$qa = $qa.Replace(
  '  const [uploading, setUploading] = useState<Record<string, boolean>>({});',
  '  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);'
)

$qa = $qa.Replace(
  '  async function submit(itemId: string, state: string) {',
  '  async function submitForApproval() {
    setSubmitting(true);
    await authFetch("/api/qa/submit", { method: "POST", body: JSON.stringify({ jobId: id }) });
    setSubmitting(false);
    setSubmitted(true);
    load();
  }

  async function submit(itemId: string, state: string) {'
)

# Add submit button before closing ScrollView
$qa = $qa.Replace(
  '      </ScrollView>',
  '      {items.length > 0 && (
        <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.05)" }}>
          <TouchableOpacity
            style={{ backgroundColor: submitted ? "rgba(0,212,160,0.1)" : "#00d4a0", borderRadius: 12, paddingVertical: 14, alignItems: "center", borderWidth: submitted ? 1 : 0, borderColor: "rgba(0,212,160,0.3)" }}
            onPress={submitForApproval}
            disabled={submitting || submitted}
          >
            <Text style={{ color: submitted ? "#00d4a0" : "#0f1923", fontWeight: "700", fontSize: 15 }}>
              {submitted ? "Submitted for approval" : submitting ? "Submitting..." : "Submit QA for approval"}
            </Text>
          </TouchableOpacity>
        </View>
      )}
      </ScrollView>'
)

[System.IO.File]::WriteAllText("C:\vantro-mobile\app\(installer)\qa.tsx", $qa, [System.Text.UTF8Encoding]::new($false))
Write-Host "QA submit button added" -ForegroundColor Green

# Commit and rebuild
git add .
git commit -m "Fix: emoji encoding, diary submit, QA approval button"
eas build --platform android --profile preview

Write-Host "Build submitted" -ForegroundColor Cyan
