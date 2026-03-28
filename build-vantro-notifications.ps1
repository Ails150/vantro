Set-Location C:\vantro-mobile

# ═══════════════════════════════════════════════════════
# STEP 1: Add expo-notifications to mobile app
# ═══════════════════════════════════════════════════════

# Update package.json to include expo-notifications
$pkg = Get-Content "C:\vantro-mobile\package.json" -Raw -Encoding UTF8
if ($pkg -notmatch "expo-notifications") {
  $pkg = $pkg.Replace(
    '"expo-linking": "~7.0.0",',
    '"expo-linking": "~7.0.0",
    "expo-notifications": "~0.29.0",
    "expo-device": "~7.0.0",'
  )
  [System.IO.File]::WriteAllText("C:\vantro-mobile\package.json", $pkg, [System.Text.UTF8Encoding]::new($false))
  Write-Host "package.json updated with notifications" -ForegroundColor Green
}

# Update app.json to add notifications plugin
$app = Get-Content "C:\vantro-mobile\app.json" -Raw -Encoding UTF8
if ($app -notmatch "expo-notifications") {
  $app = $app.Replace(
    '"expo-router",',
    '"expo-router",
      "expo-notifications",'
  )
  [System.IO.File]::WriteAllText("C:\vantro-mobile\app.json", $app, [System.Text.UTF8Encoding]::new($false))
  Write-Host "app.json updated" -ForegroundColor Green
}

# ═══════════════════════════════════════════════════════
# STEP 2: Create notifications helper lib
# ═══════════════════════════════════════════════════════

$notifLib = @'
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
import { authFetch } from "./api";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) return null;

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") return null;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("vantro", {
      name: "Vantro",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#00d4a0",
    });
  }

  const token = (await Notifications.getExpoPushTokenAsync({
    projectId: "1e578303-87f6-41d8-9abc-7b9f135f2ff0",
  })).data;

  return token;
}

export async function savePushToken(token: string) {
  await authFetch("/api/notifications/register", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}
'@

[System.IO.File]::WriteAllText("C:\vantro-mobile\lib\notifications.ts", $notifLib, [System.Text.UTF8Encoding]::new($false))
Write-Host "notifications.ts created" -ForegroundColor Green

# ═══════════════════════════════════════════════════════
# STEP 3: Update AuthContext to register push token on login
# ═══════════════════════════════════════════════════════

$auth = Get-Content "C:\vantro-mobile\context\AuthContext.tsx" -Raw -Encoding UTF8

# Add import
if ($auth -notmatch "registerForPushNotifications") {
  $auth = $auth.Replace(
    "import * as SecureStore from 'expo-secure-store';",
    "import * as SecureStore from 'expo-secure-store';
import { registerForPushNotifications, savePushToken } from '@/lib/notifications';"
  )

  # Register token after successful login
  $auth = $auth.Replace(
    "      setUser(authUser);
      return {};",
    "      setUser(authUser);

      // Register push notification token
      try {
        const pushToken = await registerForPushNotifications();
        if (pushToken) await savePushToken(pushToken);
      } catch {}

      return {};"
  )

  [System.IO.File]::WriteAllText("C:\vantro-mobile\context\AuthContext.tsx", $auth, [System.Text.UTF8Encoding]::new($false))
  Write-Host "AuthContext.tsx updated with push registration" -ForegroundColor Green
}

Write-Host "Mobile changes done - committing..." -ForegroundColor Yellow

git add .
git commit -m "Add push notification support - token registration"

# ═══════════════════════════════════════════════════════
# STEP 4: Add push_tokens column to Supabase users table
# (SQL to run in Supabase)
# ═══════════════════════════════════════════════════════

Write-Host ""
Write-Host "=== SUPABASE SQL TO RUN ===" -ForegroundColor Cyan
Write-Host "Go to Supabase > SQL Editor and run:" -ForegroundColor Yellow
Write-Host ""
Write-Host "ALTER TABLE users ADD COLUMN IF NOT EXISTS push_token text;" -ForegroundColor White
Write-Host ""

# ═══════════════════════════════════════════════════════
# STEP 5: Web app - notification API routes and cron
# ═══════════════════════════════════════════════════════

Set-Location C:\vantro

New-Item -ItemType Directory -Force -Path "app\api\notifications\register" | Out-Null
New-Item -ItemType Directory -Force -Path "app\api\notifications\cron" | Out-Null

# Token registration route
$registerRoute = @'
import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"

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
  const installer = getInstallerFromToken(request)
  if (!installer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { token } = await request.json()
  if (!token) return NextResponse.json({ error: "No token" }, { status: 400 })

  const service = await createServiceClient()
  await service.from("users").update({ push_token: token }).eq("id", installer.userId)

  return NextResponse.json({ success: true })
}
'@

[System.IO.File]::WriteAllText("C:\vantro\app\api\notifications\register\route.ts", $registerRoute, [System.Text.UTF8Encoding]::new($false))
Write-Host "Token registration route created" -ForegroundColor Green

# Cron route - handles all scheduled notifications
$cronRoute = @'
import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"

async function sendPushNotification(tokens: string[], title: string, body: string, data?: any) {
  const messages = tokens.map(token => ({
    to: token,
    sound: "default",
    title,
    body,
    data: data || {},
    channelId: "vantro",
  }))

  await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify(messages),
  })
}

export async function GET(request: Request) {
  // Verify this is called by Vercel cron
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const service = await createServiceClient()
  const now = new Date()
  const hour = now.getUTCHours()
  const ukHour = (hour + 1) % 24 // BST offset (approximate)

  // ── Sign-in reminder at 8:30am ──────────────────────
  if (ukHour === 8) {
    const today = new Date(); today.setHours(0,0,0,0)

    // Get all active job assignments
    const { data: assignments } = await service
      .from("job_assignments")
      .select("user_id, job_id, jobs(name, status), users(name, push_token)")
      .eq("jobs.status", "active")

    if (assignments) {
      // Get who has already signed in today
      const { data: signins } = await service
        .from("signins")
        .select("user_id")
        .gte("signed_in_at", today.toISOString())

      const signedInIds = new Set((signins || []).map((s: any) => s.user_id))

      for (const assignment of assignments) {
        const user = assignment.users as any
        const job = assignment.jobs as any
        if (!user?.push_token || signedInIds.has(assignment.user_id)) continue
        if (job?.status !== "active") continue

        await sendPushNotification(
          [user.push_token],
          "Sign in reminder",
          `Don't forget to sign in to ${job.name}`,
          { type: "signin_reminder", jobId: assignment.job_id }
        )
      }
    }
  }

  // ── Sign-out reminder at 6pm ─────────────────────────
  if (ukHour === 18) {
    const today = new Date(); today.setHours(0,0,0,0)

    const { data: activeSignins } = await service
      .from("signins")
      .select("user_id, job_id, jobs(name), users(name, push_token)")
      .gte("signed_in_at", today.toISOString())
      .is("signed_out_at", null)

    if (activeSignins) {
      for (const signin of activeSignins) {
        const user = signin.users as any
        const job = signin.jobs as any
        if (!user?.push_token) continue

        await sendPushNotification(
          [user.push_token],
          "Still signed in",
          `You're still signed in to ${job?.name}. Did you forget to sign out?`,
          { type: "signout_reminder", jobId: signin.job_id }
        )
      }
    }
  }

  return NextResponse.json({ success: true, hour: ukHour })
}
'@

[System.IO.File]::WriteAllText("C:\vantro\app\api\notifications\cron\route.ts", $cronRoute, [System.Text.UTF8Encoding]::new($false))
Write-Host "Cron route created" -ForegroundColor Green

# ═══════════════════════════════════════════════════════
# STEP 6: Update diary route to notify admin/foreman on alerts
# ═══════════════════════════════════════════════════════

$diary = Get-Content "C:\vantro\app\api\diary\route.ts" -Raw -Encoding UTF8

# Add push notification to admin/foreman after alert created
$oldAlertSection = '    await service.from("alerts").insert({
      company_id: resolvedCompanyId,
      job_id: jobId,
      message: (aiAlertType === "blocker" ? "BLOCKER" : "ISSUE") + " - " + (aiSummary || entryText.slice(0, 100)),
      alert_type: aiAlertType,
      is_read: false
    })'

$newAlertSection = '    await service.from("alerts").insert({
      company_id: resolvedCompanyId,
      job_id: jobId,
      message: (aiAlertType === "blocker" ? "BLOCKER" : "ISSUE") + " - " + (aiSummary || entryText.slice(0, 100)),
      alert_type: aiAlertType,
      is_read: false
    })

    // Push notify admin and foreman
    const { data: admins } = await service.from("users")
      .select("push_token, name")
      .eq("company_id", resolvedCompanyId)
      .in("role", ["admin", "foreman"])
      .not("push_token", "is", null)

    if (admins && admins.length > 0) {
      const tokens = admins.map((a: any) => a.push_token).filter(Boolean)
      if (tokens.length > 0) {
        const { data: jobData } = await service.from("jobs").select("name").eq("id", jobId).single()
        await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(tokens.map((token: string) => ({
            to: token,
            sound: "default",
            title: aiAlertType === "blocker" ? "🚨 BLOCKER on site" : "⚠️ Issue flagged",
            body: (jobData?.name || "Job") + ": " + (aiSummary || entryText.slice(0, 80)),
            data: { type: "diary_alert", jobId, alertType: aiAlertType },
            channelId: "vantro",
          })))
        }).catch(() => {})
      }
    }'

$diary = $diary.Replace($oldAlertSection, $newAlertSection)
[System.IO.File]::WriteAllText("C:\vantro\app\api\diary\route.ts", $diary, [System.Text.UTF8Encoding]::new($false))
Write-Host "Diary route updated with push notifications" -ForegroundColor Green

# ═══════════════════════════════════════════════════════
# STEP 7: Update defects route to notify on critical
# ═══════════════════════════════════════════════════════

$defectsRoute = Get-Content "C:\vantro\app\api\defects\route.ts" -Raw -Encoding UTF8

$oldDefectInsert = '    const { data, error } = await service.from("defects").insert({
      job_id: jobId, user_id: userId, company_id: companyId,
      description, severity: severity || "minor",
      photo_url: photoUrl || null, photo_path: photoPath || null'

$newDefectInsert = '    const { data, error } = await service.from("defects").insert({
      job_id: jobId, user_id: userId, company_id: companyId,
      description, severity: severity || "minor",
      photo_url: photoUrl || null, photo_path: photoPath || null'

# Add notification after defect insert - only for critical/major
$defectsRoute = $defectsRoute.Replace(
  'if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true, defect: data })',
  'if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    // Notify admin/foreman of critical or major defects
    if (severity === "critical" || severity === "major") {
      const { data: admins } = await service.from("users")
        .select("push_token")
        .eq("company_id", companyId)
        .in("role", ["admin", "foreman"])
        .not("push_token", "is", null)

      if (admins && admins.length > 0) {
        const tokens = admins.map((a: any) => a.push_token).filter(Boolean)
        if (tokens.length > 0) {
          const { data: jobData } = await service.from("jobs").select("name").eq("id", jobId).single()
          await fetch("https://exp.host/--/api/v2/push/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(tokens.map((token: string) => ({
              to: token,
              sound: "default",
              title: severity === "critical" ? "🔴 Critical defect logged" : "🟡 Major defect logged",
              body: (jobData?.name || "Job") + ": " + description.slice(0, 80),
              data: { type: "defect_alert", jobId, severity },
              channelId: "vantro",
            })))
          }).catch(() => {})
        }
      }
    }

    return NextResponse.json({ success: true, defect: data })'
)

[System.IO.File]::WriteAllText("C:\vantro\app\api\defects\route.ts", $defectsRoute, [System.Text.UTF8Encoding]::new($false))
Write-Host "Defects route updated with critical push notifications" -ForegroundColor Green

# ═══════════════════════════════════════════════════════
# STEP 8: vercel.json - cron job config
# ═══════════════════════════════════════════════════════

$vercelJson = @'
{
  "crons": [
    {
      "path": "/api/notifications/cron",
      "schedule": "30 7 * * 1-6"
    },
    {
      "path": "/api/notifications/cron",
      "schedule": "0 17 * * 1-6"
    }
  ]
}
'@

[System.IO.File]::WriteAllText("C:\vantro\vercel.json", $vercelJson, [System.Text.UTF8Encoding]::new($false))
Write-Host "vercel.json cron config created" -ForegroundColor Green

Write-Host ""
Write-Host "=== ADD THIS TO VERCEL ENVIRONMENT VARIABLES ===" -ForegroundColor Cyan
Write-Host "CRON_SECRET = any random string e.g. vantro-cron-2026" -ForegroundColor White
Write-Host ""

# ═══════════════════════════════════════════════════════
# COMMIT ALL WEB CHANGES
# ═══════════════════════════════════════════════════════

git add app\api\notifications\ app\api\diary\route.ts app\api\defects\route.ts vercel.json
git commit -m "Add push notifications - sign in/out reminders, blocker alerts, critical defect alerts"
git push origin master
Write-Host "Web changes pushed to GitHub" -ForegroundColor Cyan

# ═══════════════════════════════════════════════════════
# BUILD NEW MOBILE APK
# ═══════════════════════════════════════════════════════
Set-Location C:\vantro-mobile
npm install --legacy-peer-deps
git add .
git commit -m "Add expo-notifications for push alerts"
eas build --platform android --profile preview

Write-Host ""
Write-Host "=== NEXT STEPS ===" -ForegroundColor Yellow
Write-Host "1. Run this SQL in Supabase SQL Editor:" -ForegroundColor White
Write-Host "   ALTER TABLE users ADD COLUMN IF NOT EXISTS push_token text;" -ForegroundColor Green
Write-Host "2. Add CRON_SECRET env var in Vercel dashboard" -ForegroundColor White
Write-Host "3. Install new APK when build finishes" -ForegroundColor White
