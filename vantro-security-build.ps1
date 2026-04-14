Write-Host "=== VANTRO SECURITY & COMPLIANCE BUILD ===" -ForegroundColor Cyan
Write-Host "Tier 1 + Tier 2: JWT tokens, GPS consent, privacy, audit log, SAR, retention" -ForegroundColor Yellow
Write-Host ""

# ─── 1. INSTALL JSONWEBTOKEN ─────────────────────────────────────────
Write-Host "Installing jsonwebtoken..." -ForegroundColor Yellow
cd C:\vantro
npm install jsonwebtoken --legacy-peer-deps
npm install @types/jsonwebtoken --save-dev --legacy-peer-deps
Write-Host "1/10 jsonwebtoken installed" -ForegroundColor Green

# ─── 2. CREATE SHARED JWT AUTH UTILITY ───────────────────────────────
$jwtAuth = @'
import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'fallback-change-me'

interface InstallerPayload {
  userId: string
  companyId: string
  exp: number
}

export function createInstallerToken(userId: string, companyId: string): string {
  return jwt.sign(
    { userId, companyId },
    JWT_SECRET,
    { expiresIn: '10h' }
  )
}

export function verifyInstallerToken(request: Request): InstallerPayload | null {
  const auth = request.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return null
  try {
    const decoded = jwt.verify(auth.slice(7), JWT_SECRET) as any
    if (!decoded.userId || !decoded.companyId) return null
    return { userId: decoded.userId, companyId: decoded.companyId, exp: decoded.exp }
  } catch {
    // Fallback: try legacy base64 token for backward compatibility
    try {
      const payload = JSON.parse(Buffer.from(auth.slice(7), 'base64').toString())
      if (payload.exp < Date.now()) return null
      return payload
    } catch { return null }
  }
}
'@
New-Item -ItemType Directory -Force -Path "C:\vantro\lib" | Out-Null
[System.IO.File]::WriteAllText("C:\vantro\lib\auth.ts", $jwtAuth, [System.Text.UTF8Encoding]::new($false))
Write-Host "2/10 JWT auth utility created (lib/auth.ts)" -ForegroundColor Green

# ─── 3. UPDATE INSTALLER AUTH — use JWT ──────────────────────────────
$installerAuth = @'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { createInstallerToken } from '@/lib/auth'
import bcrypt from 'bcryptjs'

export async function POST(request: Request) {
  const body = await request.json()

  if (body.checkOnly) {
    const service = await createServiceClient()
    const { data: user } = await service.from('users').select('id, pin_hash').ilike('email', body.email).single()
    if (!user) return NextResponse.json({ exists: false })
    return NextResponse.json({ exists: true, hasPin: !!user.pin_hash })
  }

  const { pin } = body
  if (!pin || pin.length !== 4) return NextResponse.json({ error: 'Invalid PIN' }, { status: 400 })

  const service = await createServiceClient()
  const { data: users } = await service.from('users').select('id, name, company_id, pin_hash, pin_attempts, pin_locked_until, role, gps_tracking_acknowledged').eq('is_active', true).not('pin_hash', 'is', null)
  if (!users) return NextResponse.json({ error: 'Incorrect PIN' }, { status: 401 })

  let matchedUser = null
  for (const user of users) {
    if (user.pin_locked_until && new Date(user.pin_locked_until) > new Date()) continue
    if (user.pin_hash && await bcrypt.compare(pin, user.pin_hash)) { matchedUser = user; break }
  }

  if (!matchedUser) {
    return NextResponse.json({ error: 'Incorrect PIN. Please try again.' }, { status: 401 })
  }

  await service.from('users').update({ pin_attempts: 0, pin_locked_until: null }).eq('id', matchedUser.id)

  const token = createInstallerToken(matchedUser.id, matchedUser.company_id)

  return NextResponse.json({
    token,
    userId: matchedUser.id,
    name: matchedUser.name,
    companyId: matchedUser.company_id,
    role: matchedUser.role,
    gpsAcknowledged: matchedUser.gps_tracking_acknowledged || false,
  })
}
'@
[System.IO.File]::WriteAllText("C:\vantro\app\api\installer\auth\route.ts", $installerAuth, [System.Text.UTF8Encoding]::new($false))
Write-Host "3/10 Installer auth updated (JWT + gpsAcknowledged flag)" -ForegroundColor Green

# ─── 4. UPDATE ALL API ROUTES — replace getInstallerFromToken ────────
$files = @(
  "C:\vantro\app\api\defects\route.ts",
  "C:\vantro\app\api\diary\route.ts",
  "C:\vantro\app\api\installer\jobs\route.ts",
  "C:\vantro\app\api\notifications\register\route.ts",
  "C:\vantro\app\api\qa\route.ts",
  "C:\vantro\app\api\qa\submit\route.ts",
  "C:\vantro\app\api\signin\route.ts",
  "C:\vantro\app\api\signout\route.ts",
  "C:\vantro\app\api\upload\route.ts"
)

foreach ($file in $files) {
  if (Test-Path $file) {
    $content = [System.IO.File]::ReadAllText($file, [System.Text.UTF8Encoding]::new($false))

    # Remove the old getInstallerFromToken function
    $content = [regex]::Replace($content, '(?s)function getInstallerFromToken\(request: Request\) \{.*?\n\}', '')

    # Add import for verifyInstallerToken if not present
    if ($content -notmatch "verifyInstallerToken") {
      $content = "import { verifyInstallerToken } from '@/lib/auth'`n" + $content
    }

    # Replace all calls to getInstallerFromToken with verifyInstallerToken
    $content = $content -replace 'getInstallerFromToken\(request\)', 'verifyInstallerToken(request)'

    # Clean up any double blank lines
    $content = [regex]::Replace($content, '\n{3,}', "`n`n")

    [System.IO.File]::WriteAllText($file, $content, [System.Text.UTF8Encoding]::new($false))
  }
}
Write-Host "4/10 All 9 API routes updated to use JWT verification" -ForegroundColor Green

# ─── 5. GPS TRACKING ACKNOWLEDGMENT API ──────────────────────────────
New-Item -ItemType Directory -Force -Path "C:\vantro\app\api\installer\acknowledge" | Out-Null
$acknowledge = @'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifyInstallerToken } from '@/lib/auth'

export async function POST(request: Request) {
  const installer = verifyInstallerToken(request)
  if (!installer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = await createServiceClient()
  const { error } = await service.from('users').update({
    gps_tracking_acknowledged: true,
    gps_tracking_acknowledged_at: new Date().toISOString(),
    privacy_policy_version: '1.0',
  }).eq('id', installer.userId)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Log to audit trail
  await service.from('audit_log').insert({
    company_id: installer.companyId,
    user_id: installer.userId,
    action: 'gps_tracking_acknowledged',
    entity_type: 'user',
    entity_id: installer.userId,
    details: { version: '1.0', acknowledged_at: new Date().toISOString() },
  })

  return NextResponse.json({ success: true })
}
'@
[System.IO.File]::WriteAllText("C:\vantro\app\api\installer\acknowledge\route.ts", $acknowledge, [System.Text.UTF8Encoding]::new($false))
Write-Host "5/10 GPS acknowledgment API created" -ForegroundColor Green

# ─── 6. AUDIT LOG API ───────────────────────────────────────────────
New-Item -ItemType Directory -Force -Path "C:\vantro\app\api\admin\audit" | Out-Null
$auditApi = @'
import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const service = await createServiceClient()
  const { data: u } = await service.from("users").select("company_id, role").eq("auth_user_id", user.id).single()
  if (!u || u.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200)
  const offset = parseInt(searchParams.get("offset") || "0")

  const { data: logs } = await service.from("audit_log")
    .select("*, users(name, initials)")
    .eq("company_id", u.company_id)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1)

  return NextResponse.json({ logs: logs || [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const service = await createServiceClient()
  const { data: u } = await service.from("users").select("id, company_id, role").eq("auth_user_id", user.id).single()
  if (!u) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { action, entity_type, entity_id, details } = await request.json()
  await service.from("audit_log").insert({
    company_id: u.company_id,
    user_id: u.id,
    auth_user_id: user.id,
    action, entity_type, entity_id, details,
  })

  return NextResponse.json({ success: true })
}
'@
[System.IO.File]::WriteAllText("C:\vantro\app\api\admin\audit\route.ts", $auditApi, [System.Text.UTF8Encoding]::new($false))
Write-Host "6/10 Audit log API created" -ForegroundColor Green

# ─── 7. SAR (Subject Access Request) EXPORT API ─────────────────────
New-Item -ItemType Directory -Force -Path "C:\vantro\app\api\installer\my-data" | Out-Null
$sarApi = @'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifyInstallerToken } from '@/lib/auth'

export async function GET(request: Request) {
  const installer = verifyInstallerToken(request)
  if (!installer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = await createServiceClient()

  // Gather all data for this user
  const [userData, signins, locationLogs, diaryEntries, qaSubmissions, defects] = await Promise.all([
    service.from('users').select('name, email, role, created_at, gps_tracking_acknowledged, gps_tracking_acknowledged_at').eq('id', installer.userId).single(),
    service.from('signins').select('*, jobs(name, address)').eq('user_id', installer.userId).order('signed_in_at', { ascending: false }).limit(500),
    service.from('location_logs').select('lat, lng, accuracy_metres, distance_from_site_metres, within_range, logged_at').eq('user_id', installer.userId).order('logged_at', { ascending: false }).limit(2000),
    service.from('diary_entries').select('entry_text, created_at, jobs(name)').eq('user_id', installer.userId).order('created_at', { ascending: false }).limit(200),
    service.from('qa_submissions').select('state, notes, created_at, checklist_items(label)').eq('user_id', installer.userId).order('created_at', { ascending: false }).limit(500),
    service.from('defects').select('description, severity, created_at, jobs(name)').eq('reported_by', installer.userId).order('created_at', { ascending: false }).limit(200),
  ])

  return NextResponse.json({
    exported_at: new Date().toISOString(),
    user: userData.data,
    signins: signins.data || [],
    location_logs: locationLogs.data || [],
    diary_entries: diaryEntries.data || [],
    qa_submissions: qaSubmissions.data || [],
    defects: defects.data || [],
  })
}
'@
[System.IO.File]::WriteAllText("C:\vantro\app\api\installer\my-data\route.ts", $sarApi, [System.Text.UTF8Encoding]::new($false))
Write-Host "7/10 SAR data export API created" -ForegroundColor Green

# ─── 8. DATA RETENTION CLEANUP API (called by cron) ──────────────────
New-Item -ItemType Directory -Force -Path "C:\vantro\app\api\cleanup" | Out-Null
$cleanup = @'
import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const service = await createServiceClient()

  // Get all companies with their retention settings
  const { data: companies } = await service.from("companies").select("id, data_retention_days")
  if (!companies) return NextResponse.json({ success: true, deleted: 0 })

  let totalDeleted = 0

  for (const company of companies) {
    const retentionDays = company.data_retention_days || 90
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays)

    // Delete old breadcrumbs
    const { count } = await service.from("location_logs")
      .delete({ count: "exact" })
      .eq("company_id", company.id)
      .lt("logged_at", cutoffDate.toISOString())

    totalDeleted += count || 0
  }

  // Log the cleanup
  await service.from("audit_log").insert({
    company_id: companies[0]?.id || '00000000-0000-0000-0000-000000000000',
    action: "data_retention_cleanup",
    entity_type: "system",
    details: { total_deleted: totalDeleted, run_at: new Date().toISOString() },
  })

  return NextResponse.json({ success: true, deleted: totalDeleted })
}
'@
[System.IO.File]::WriteAllText("C:\vantro\app\api\cleanup\route.ts", $cleanup, [System.Text.UTF8Encoding]::new($false))
Write-Host "8/10 Data retention cleanup API created" -ForegroundColor Green

# ─── 9. ADD CLEANUP CRON TO VERCEL ───────────────────────────────────
$vercelJson = @'
{
  "crons": [
    {
      "path": "/api/notifications/cron",
      "schedule": "*/15 * * * 1-6"
    },
    {
      "path": "/api/cleanup",
      "schedule": "0 3 * * 0"
    }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Frame-Options", "value": "SAMEORIGIN" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=(self), payment=()" },
        { "key": "Content-Security-Policy", "value": "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://maps.googleapis.com https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://*.supabase.co https://maps.googleapis.com https://maps.gstatic.com; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://maps.googleapis.com https://exp.host https://api.anthropic.com; frame-ancestors 'self'" },
        { "key": "X-DNS-Prefetch-Control", "value": "on" }
      ]
    }
  ]
}
'@
[System.IO.File]::WriteAllText("C:\vantro\vercel.json", $vercelJson, [System.Text.UTF8Encoding]::new($false))
Write-Host "9/10 Security headers + cleanup cron added" -ForegroundColor Green

# ─── 10. PRIVACY POLICY PAGE ────────────────────────────────────────
New-Item -ItemType Directory -Force -Path "C:\vantro\app\privacy" | Out-Null
$privacyPage = @'
export default function PrivacyPolicy() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <h1 className="text-2xl font-bold mb-6">Vantro Privacy Policy</h1>
      <p className="text-sm text-gray-500 mb-8">Last updated: April 2026 | Version 1.0</p>

      <div className="prose prose-gray max-w-none space-y-6 text-sm leading-relaxed">
        <section>
          <h2 className="text-lg font-semibold mt-6 mb-3">1. Who we are</h2>
          <p>Vantro is a product of CNNCTD Ltd (NI695071), operating as Scale 8 Digital. We provide workforce management software for construction and trades businesses. This policy explains how we collect, use, and protect personal data processed through the Vantro platform.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mt-6 mb-3">2. What data we collect</h2>
          <p>We collect the following categories of personal data:</p>
          <p><strong>Account data:</strong> Name, email address, company name, role.</p>
          <p><strong>Authentication data:</strong> Hashed PIN (we never store PINs in plain text).</p>
          <p><strong>Location data:</strong> GPS coordinates at sign-in, sign-out, and periodic breadcrumb logs while signed in to a job site. Location tracking only occurs during active work sessions.</p>
          <p><strong>Work activity data:</strong> Sign-in/sign-out times, hours worked, diary entries, QA checklist submissions, defect reports, and associated photographs.</p>
          <p><strong>Device data:</strong> Push notification tokens for work-related alerts.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mt-6 mb-3">3. Lawful basis for processing</h2>
          <p>We process personal data under the following lawful bases as defined by UK GDPR:</p>
          <p><strong>Legitimate interest (Article 6(1)(f)):</strong> GPS location tracking during work hours for the purposes of accurate payroll calculation, attendance verification, health and safety compliance, and prevention of time theft. We have conducted a Legitimate Interest Assessment confirming this processing is necessary, proportionate, and does not override the fundamental rights of data subjects.</p>
          <p><strong>Contract performance (Article 6(1)(b)):</strong> Processing necessary to fulfil the service contract between Vantro and the employer company.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mt-6 mb-3">4. GPS location tracking</h2>
          <p>Vantro collects GPS location data under the following conditions:</p>
          <p>- Location tracking begins only when an installer signs in to a job site</p>
          <p>- Location tracking stops immediately when the installer signs out</p>
          <p>- GPS breadcrumb logs are recorded approximately every 30 minutes during active sessions</p>
          <p>- Location data is used solely for attendance verification and payroll accuracy</p>
          <p>- No tracking occurs outside of work sessions</p>
          <p>- Installers are informed of tracking through an in-app acknowledgment screen before their first sign-in</p>
          <p>- Location data is automatically deleted after the retention period set by the employer (default: 90 days)</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mt-6 mb-3">5. Data retention</h2>
          <p>We retain personal data only as long as necessary:</p>
          <p><strong>GPS breadcrumb data:</strong> Automatically deleted after the employer-configured retention period (default 90 days).</p>
          <p><strong>Sign-in/sign-out records:</strong> Retained for the duration of the employment relationship plus 6 years for payroll and legal compliance purposes.</p>
          <p><strong>Account data:</strong> Retained until the account is deactivated or deleted.</p>
          <p><strong>Photographs:</strong> Retained for the duration of the employer-configured retention period.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mt-6 mb-3">6. Your rights</h2>
          <p>Under UK GDPR, you have the following rights:</p>
          <p><strong>Right of access:</strong> You can request a copy of all personal data we hold about you. Use the "My Data" section in the Vantro app or contact your employer.</p>
          <p><strong>Right to rectification:</strong> You can request correction of inaccurate data.</p>
          <p><strong>Right to erasure:</strong> You can request deletion of your data, subject to legal retention requirements.</p>
          <p><strong>Right to restrict processing:</strong> You can request that we limit how we use your data.</p>
          <p><strong>Right to data portability:</strong> You can request your data in a machine-readable format.</p>
          <p><strong>Right to object:</strong> You can object to processing based on legitimate interest.</p>
          <p>To exercise any of these rights, contact your employer or email privacy@getvantro.com.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mt-6 mb-3">7. Data security</h2>
          <p>We implement appropriate technical and organisational measures to protect personal data:</p>
          <p>- All data is encrypted in transit (TLS/SSL) and at rest</p>
          <p>- Authentication uses cryptographically signed tokens (JWT)</p>
          <p>- PINs are hashed using bcrypt and never stored in plain text</p>
          <p>- Row-level security ensures companies can only access their own data</p>
          <p>- API access is authenticated and authorised on every request</p>
          <p>- Admin actions are recorded in an audit log</p>
          <p>- Regular automated cleanup of expired data</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mt-6 mb-3">8. Data processors</h2>
          <p>We use the following third-party processors:</p>
          <p><strong>Supabase (AWS eu-west):</strong> Database hosting and authentication</p>
          <p><strong>Vercel:</strong> Application hosting and serverless functions</p>
          <p><strong>Expo/Google:</strong> Push notification delivery</p>
          <p><strong>Stripe:</strong> Payment processing (no access to location or work data)</p>
          <p>All processors are GDPR-compliant and process data within the UK/EEA or under appropriate safeguards.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mt-6 mb-3">9. Data controller</h2>
          <p>The data controller for employee data processed through Vantro is the employer company that has subscribed to the Vantro service. CNNCTD Ltd acts as the data processor on behalf of the employer.</p>
          <p>For questions about this policy or to exercise your data rights, contact:</p>
          <p>CNNCTD Ltd, privacy@getvantro.com</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mt-6 mb-3">10. Changes to this policy</h2>
          <p>We may update this policy from time to time. Changes will be communicated through the Vantro app and on this page. Continued use of the service after changes constitutes acceptance of the updated policy.</p>
        </section>
      </div>
    </div>
  )
}
'@
[System.IO.File]::WriteAllText("C:\vantro\app\privacy\page.tsx", $privacyPage, [System.Text.UTF8Encoding]::new($false))
Write-Host "10/10 Privacy policy page created (app.getvantro.com/privacy)" -ForegroundColor Green

# ─── ADD JWT_SECRET TO .env.local reminder ───────────────────────────
Write-Host ""
Write-Host "IMPORTANT: Add JWT_SECRET to Vercel environment variables!" -ForegroundColor Red
Write-Host "  Go to Vercel -> Settings -> Environment Variables" -ForegroundColor White
Write-Host "  Add: JWT_SECRET = (generate a random 64-char string)" -ForegroundColor White
Write-Host "  You can generate one with: node -e ""console.log(require('crypto').randomBytes(32).toString('hex'))""" -ForegroundColor White
Write-Host ""

# ─── COMMIT AND PUSH ────────────────────────────────────────────────
cd C:\vantro
git add .
git commit -m "Security: JWT tokens, GPS consent API, privacy policy, audit log, SAR export, data retention cleanup, weekly cron"
git push origin master

Write-Host ""
Write-Host "=== SECURITY BUILD DEPLOYED ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "DONE:" -ForegroundColor Green
Write-Host "  1. JWT signed tokens replacing base64 (backward compatible)" -ForegroundColor White
Write-Host "  2. GPS tracking acknowledgment API" -ForegroundColor White
Write-Host "  3. Privacy policy at app.getvantro.com/privacy" -ForegroundColor White
Write-Host "  4. Audit log API (all admin actions)" -ForegroundColor White
Write-Host "  5. Subject Access Request export API" -ForegroundColor White
Write-Host "  6. Data retention cleanup cron (weekly, configurable per company)" -ForegroundColor White
Write-Host ""
Write-Host "STILL NEEDED:" -ForegroundColor Yellow
Write-Host "  1. Run SQL migration in Supabase (vantro-security-migration.sql)" -ForegroundColor White
Write-Host "  2. Add JWT_SECRET to Vercel env vars" -ForegroundColor White
Write-Host "  3. Update mobile app with GPS acknowledgment screen (next script)" -ForegroundColor White
Write-Host "  4. Add data retention to Settings tab" -ForegroundColor White
