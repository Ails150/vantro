Write-Host "=== VANTRO GPS TRACKING & TIME MANAGEMENT ===" -ForegroundColor Cyan
Write-Host ""

# ─── 1. UPDATE SIGN-OUT API — capture GPS location ──────────────────
$signout = @'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

function getInstallerFromToken(request: Request) {
  const auth = request.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return null
  try {
    const payload = JSON.parse(Buffer.from(auth.slice(7), 'base64').toString())
    if (payload.exp < Date.now()) return null
    return payload
  } catch { return null }
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)))
}

export async function POST(request: Request) {
  const installer = getInstallerFromToken(request)
  if (!installer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { jobId, lat, lng, accuracy } = await request.json()
  const service = await createServiceClient()

  // Get job location for distance check
  const { data: job } = await service.from('jobs').select('lat, lng, name, company_id').eq('id', jobId).single()
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  // Get company geofence radius (default 150m)
  const { data: company } = await service.from('companies').select('geofence_radius_metres').eq('id', job.company_id).single()
  const radius = company?.geofence_radius_metres || 150

  let distanceMetres = 0
  let withinRange = true

  if (job.lat && job.lng && lat && lng) {
    distanceMetres = haversine(lat, lng, job.lat, job.lng)
    withinRange = distanceMetres <= radius

    if (!withinRange) {
      return NextResponse.json({
        error: `You are ${distanceMetres}m from ${job.name}. You must be within ${radius}m to sign out.`,
        distanceMetres,
        withinRange: false
      }, { status: 400 })
    }
  }

  const today = new Date(); today.setHours(0,0,0,0)
  const now = new Date()

  // Find the active signin
  const { data: signin } = await service.from('signins')
    .select('id, signed_in_at, expected_sign_out_time')
    .eq('job_id', jobId)
    .eq('user_id', installer.userId)
    .gte('signed_in_at', today.toISOString())
    .is('signed_out_at', null)
    .maybeSingle()

  if (!signin) return NextResponse.json({ error: 'No active sign-in found' }, { status: 400 })

  // Calculate hours worked
  const signedInAt = new Date(signin.signed_in_at)
  const hoursWorked = Math.round(((now.getTime() - signedInAt.getTime()) / 3600000) * 100) / 100

  // Check for early departure
  let departedEarly = false
  let earlyDepartureMinutes = 0

  if (signin.expected_sign_out_time) {
    const [eh, em] = signin.expected_sign_out_time.split(':').map(Number)
    const expectedMinutes = eh * 60 + em
    const nowUkHour = (now.getUTCHours() + 1) % 24 // BST
    const nowMinutes = nowUkHour * 60 + now.getUTCMinutes()
    if (nowMinutes < expectedMinutes - 5) { // 5 min grace for early
      departedEarly = true
      earlyDepartureMinutes = expectedMinutes - nowMinutes
    }
  }

  const updateData: any = {
    signed_out_at: now.toISOString(),
    sign_out_lat: lat || null,
    sign_out_lng: lng || null,
    sign_out_accuracy_metres: accuracy ? Math.round(accuracy) : null,
    sign_out_distance_metres: distanceMetres,
    sign_out_within_range: withinRange,
    hours_worked: hoursWorked,
    departed_early: departedEarly,
    early_departure_minutes: earlyDepartureMinutes > 0 ? earlyDepartureMinutes : null,
  }

  if (departedEarly) {
    updateData.flagged = true
    updateData.flag_reason = `Left ${Math.floor(earlyDepartureMinutes / 60)}h ${earlyDepartureMinutes % 60}m early`
  }

  const { error } = await service
    .from('signins')
    .update(updateData)
    .eq('id', signin.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true, distanceMetres, withinRange, hoursWorked, departedEarly, earlyDepartureMinutes })
}
'@
[System.IO.File]::WriteAllText("C:\vantro\app\api\signout\route.ts", $signout, [System.Text.UTF8Encoding]::new($false))
Write-Host "1/8 Sign-out API updated (GPS + hours + early departure)" -ForegroundColor Green

# ─── 1b. UPDATE SIGN-IN API — store expected sign-out time ───────────
$signin = @'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

function getInstallerFromToken(request: Request) {
  const auth = request.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return null
  try {
    const payload = JSON.parse(Buffer.from(auth.slice(7), 'base64').toString())
    if (payload.exp < Date.now()) return null
    return payload
  } catch { return null }
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)))
}

export async function POST(request: Request) {
  const installer = getInstallerFromToken(request)
  if (!installer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { jobId, lat, lng, accuracy } = await request.json()
  const service = await createServiceClient()

  const { data: job } = await service.from('jobs').select('lat, lng, company_id, name, sign_out_time').eq('id', jobId).single()
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  // Get company defaults
  const { data: company } = await service.from('companies')
    .select('geofence_radius_metres, default_sign_out_time')
    .eq('id', job.company_id).single()

  const radius = company?.geofence_radius_metres || 150
  let distanceMetres = 0
  let withinRange = true

  if (job.lat && job.lng) {
    distanceMetres = Math.round(haversine(lat, lng, job.lat, job.lng))
    withinRange = distanceMetres <= radius

    if (!withinRange) {
      return NextResponse.json({
        error: `You are ${distanceMetres}m from ${job.name}. You must be within ${radius}m to sign in.`,
        distanceMetres,
        withinRange: false
      }, { status: 400 })
    }
  }

  // Block if already signed in to ANY job
  const today = new Date(); today.setHours(0,0,0,0)
  const { data: existing } = await service.from('signins')
    .select('id, job_id, jobs(name)')
    .eq('user_id', installer.userId)
    .gte('signed_in_at', today.toISOString())
    .is('signed_out_at', null)
    .limit(1)
    .maybeSingle()

  if (existing) {
    if (existing.job_id === jobId) {
      return NextResponse.json({ success: true, distanceMetres, withinRange, alreadySignedIn: true })
    }
    const otherJobName = (existing.jobs as any)?.name || 'another job'
    return NextResponse.json({ error: `You are already signed in to ${otherJobName}. Sign out first.` }, { status: 400 })
  }

  // Determine expected sign-out time: job override > company default
  const expectedSignOutTime = job.sign_out_time || company?.default_sign_out_time || null

  const { error } = await service.from('signins').insert({
    job_id: jobId,
    user_id: installer.userId,
    company_id: job.company_id,
    lat, lng,
    accuracy_metres: accuracy,
    distance_from_site_metres: distanceMetres,
    within_range: withinRange,
    expected_sign_out_time: expectedSignOutTime,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ success: true, distanceMetres, withinRange })
}
'@
[System.IO.File]::WriteAllText("C:\vantro\app\api\signin\route.ts", $signin, [System.Text.UTF8Encoding]::new($false))
Write-Host "2/8 Sign-in API updated (captures expected sign-out time)" -ForegroundColor Green

# ─── 1c. ASSIGN ALL INSTALLERS API ──────────────────────────────────
New-Item -ItemType Directory -Force -Path "C:\vantro\app\api\admin\assign-all" | Out-Null
$assignAll = @'
import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const service = await createServiceClient()
  const { data: u } = await service.from("users").select("company_id, role").eq("auth_user_id", user.id).single()
  if (!u || !["admin", "foreman"].includes(u.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { jobId } = await request.json()
  if (!jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 })

  // Get all installers in the company
  const { data: installers } = await service.from("users")
    .select("id")
    .eq("company_id", u.company_id)
    .eq("role", "installer")

  if (!installers || installers.length === 0) {
    return NextResponse.json({ error: "No installers found" }, { status: 400 })
  }

  // Get existing assignments
  const { data: existing } = await service.from("job_assignments")
    .select("user_id")
    .eq("job_id", jobId)

  const existingIds = new Set((existing || []).map((e: any) => e.user_id))

  // Insert only new assignments
  const newAssignments = installers
    .filter(i => !existingIds.has(i.id))
    .map(i => ({ job_id: jobId, user_id: i.id, company_id: u.company_id }))

  if (newAssignments.length > 0) {
    await service.from("job_assignments").insert(newAssignments)
  }

  return NextResponse.json({
    success: true,
    assigned: newAssignments.length,
    alreadyAssigned: existingIds.size,
    total: installers.length,
  })
}
'@
[System.IO.File]::WriteAllText("C:\vantro\app\api\admin\assign-all\route.ts", $assignAll, [System.Text.UTF8Encoding]::new($false))
Write-Host "3/8 Assign-all-installers API created" -ForegroundColor Green

# ─── 2. BREADCRUMB LOCATION LOG API ──────────────────────────────────
New-Item -ItemType Directory -Force -Path "C:\vantro\app\api\location" | Out-Null
$locationLog = @'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

function getInstallerFromToken(request: Request) {
  const auth = request.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return null
  try {
    const payload = JSON.parse(Buffer.from(auth.slice(7), 'base64').toString())
    if (payload.exp < Date.now()) return null
    return payload
  } catch { return null }
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)))
}

export async function POST(request: Request) {
  const installer = getInstallerFromToken(request)
  if (!installer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { lat, lng, accuracy } = await request.json()
  if (!lat || !lng) return NextResponse.json({ error: 'Missing coordinates' }, { status: 400 })

  const service = await createServiceClient()
  const today = new Date(); today.setHours(0,0,0,0)

  // Find active signin
  const { data: signin } = await service.from('signins')
    .select('id, job_id, company_id, jobs(lat, lng)')
    .eq('user_id', installer.userId)
    .gte('signed_in_at', today.toISOString())
    .is('signed_out_at', null)
    .maybeSingle()

  if (!signin) return NextResponse.json({ error: 'Not signed in' }, { status: 400 })

  const job = signin.jobs as any
  let distanceFromSite = 0
  let withinRange = true

  if (job?.lat && job?.lng) {
    distanceFromSite = haversine(lat, lng, job.lat, job.lng)
    withinRange = distanceFromSite <= 150
  }

  await service.from('location_logs').insert({
    signin_id: signin.id,
    user_id: installer.userId,
    company_id: signin.company_id,
    job_id: signin.job_id,
    lat, lng,
    accuracy_metres: accuracy ? Math.round(accuracy) : null,
    distance_from_site_metres: distanceFromSite,
    within_range: withinRange,
  })

  return NextResponse.json({ success: true, distanceFromSite, withinRange })
}
'@
[System.IO.File]::WriteAllText("C:\vantro\app\api\location\route.ts", $locationLog, [System.Text.UTF8Encoding]::new($false))
Write-Host "4/8 updated - Breadcrumb location API created" -ForegroundColor Green

# ─── 3. UPDATE CRON — add auto-cutoff at configurable hour ──────────
$cron = @'
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
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const service = await createServiceClient()
  const now = new Date()
  const utcHour = now.getUTCHours()
  const utcMinute = now.getUTCMinutes()
  const ukHour = (utcHour + 1) % 24 // BST offset
  const currentMinutes = ukHour * 60 + utcMinute

  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  // ── Sign-in reminder: runs every 30 mins, checks jobs starting within next 30 mins ──
  const { data: activeJobs } = await service
    .from("jobs")
    .select("id, name, start_time, company_id")
    .eq("status", "active")
    .not("start_time", "is", null)

  if (activeJobs) {
    for (const job of activeJobs) {
      const [h, m] = job.start_time.split(":").map(Number)
      const jobMinutes = h * 60 + m

      if (jobMinutes > currentMinutes && jobMinutes <= currentMinutes + 30) {
        const minutesUntil = jobMinutes - currentMinutes

        const { data: assignments } = await service
          .from("job_assignments")
          .select("user_id, users(name, push_token)")
          .eq("job_id", job.id)

        if (!assignments) continue

        const { data: signins } = await service
          .from("signins")
          .select("user_id")
          .eq("job_id", job.id)
          .gte("signed_in_at", today.toISOString())

        const signedInIds = new Set((signins || []).map((s: any) => s.user_id))

        for (const assignment of assignments) {
          const user = assignment.users as any
          if (!user?.push_token || signedInIds.has(assignment.user_id)) continue
          await sendPushNotification(
            [user.push_token],
            "Shift reminder",
            `Your shift at ${job.name} starts in ${minutesUntil} minute${minutesUntil !== 1 ? "s" : ""}`,
            { type: "signin_reminder", jobId: job.id }
          )
        }
      }
    }
  }

  // ── SIGN-OUT REMINDERS: Based on job/company sign-out time ──
  // Get all active signins with their expected sign-out time
  const { data: activeSignins } = await service
    .from("signins")
    .select("id, user_id, job_id, company_id, signed_in_at, expected_sign_out_time, jobs(name, company_id), users(name, push_token)")
    .gte("signed_in_at", today.toISOString())
    .is("signed_out_at", null)

  if (activeSignins && activeSignins.length > 0) {
    // Get company settings for grace periods
    const companyIds = [...new Set(activeSignins.map(s => s.company_id))]
    const { data: companies } = await service
      .from("companies")
      .select("id, grace_period_minutes, default_sign_out_time")
      .in("id", companyIds)

    const companySettings = new Map((companies || []).map((c: any) => [c.id, c]))

    for (const signin of activeSignins) {
      const user = signin.users as any
      const job = signin.jobs as any
      if (!user?.push_token) continue

      const settings = companySettings.get(signin.company_id)
      const gracePeriod = settings?.grace_period_minutes ?? 60

      // Get expected sign-out time in minutes
      const signOutTime = signin.expected_sign_out_time
      if (!signOutTime) continue

      const [soh, som] = signOutTime.split(":").map(Number)
      const signOutMinutes = soh * 60 + som

      const minutesPastSignOut = currentMinutes - signOutMinutes

      if (minutesPastSignOut >= 0) {
        // Past sign-out time — send reminders every 15 mins
        if (minutesPastSignOut % 15 < 5) { // within 5 min window of each 15-min mark (cron runs every 15 mins)
          const graceRemaining = gracePeriod - minutesPastSignOut

          if (graceRemaining > 0) {
            // Still within grace period — send reminder
            const timeStr = `${soh}:${som.toString().padStart(2, "0")}`
            await sendPushNotification(
              [user.push_token],
              "Please sign out",
              `Your sign-out time was ${timeStr}. Please return to site and sign out. If you do not sign out within ${graceRemaining} minutes, your hours will be recorded as zero.`,
              { type: "signout_reminder", jobId: signin.job_id }
            )
          } else {
            // Grace period expired — auto-close with zero hours
            await service.from("signins").update({
              signed_out_at: now.toISOString(),
              hours_worked: 0,
              auto_closed: true,
              auto_closed_reason: "cutoff_zero",
              flagged: true,
              flag_reason: `Did not sign out. Expected: ${soh}:${som.toString().padStart(2, "0")}. Auto-closed after ${gracePeriod} min grace. Zero hours.`,
            }).eq("id", signin.id)

            await sendPushNotification(
              [user.push_token],
              "Hours recorded as zero",
              `You did not sign out of ${job?.name}. Your hours for today have been recorded as zero. Please speak to your manager.`,
              { type: "auto_cutoff", jobId: signin.job_id }
            )

            // Notify admins
            const { data: admins } = await service.from("users")
              .select("push_token")
              .eq("company_id", signin.company_id)
              .in("role", ["admin", "foreman"])
              .not("push_token", "is", null)

            if (admins && admins.length > 0) {
              await sendPushNotification(
                admins.map((a: any) => a.push_token).filter(Boolean),
                "Zero hours recorded",
                `${user?.name} did not sign out of ${job?.name}. Zero hours recorded automatically.`,
                { type: "admin_auto_cutoff" }
              )
            }
          }
        }
      }
    }

    // Notify admins about everyone still signed in (once per hour at the top of the hour)
    if (utcMinute < 5) {
      const uniqueCompanies = new Set(activeSignins.map((s: any) => s.jobs?.company_id).filter(Boolean))
      for (const companyId of uniqueCompanies) {
        const { data: admins } = await service.from("users")
          .select("push_token")
          .eq("company_id", companyId)
          .in("role", ["admin", "foreman"])
          .not("push_token", "is", null)
        if (admins && admins.length > 0) {
          const tokens = admins.map((a: any) => a.push_token).filter(Boolean)
          const stillOnSite = activeSignins.filter((s: any) => s.jobs?.company_id === companyId)
          const pastDue = stillOnSite.filter((s: any) => {
            if (!s.expected_sign_out_time) return false
            const [h, m] = s.expected_sign_out_time.split(":").map(Number)
            return currentMinutes > h * 60 + m
          })
          if (pastDue.length > 0) {
            await sendPushNotification(
              tokens,
              `${pastDue.length} installer${pastDue.length > 1 ? "s" : ""} past sign-out time`,
              `${pastDue.map((s: any) => (s.users as any)?.name).join(", ")} — still signed in past expected finish`,
              { type: "admin_past_signout" }
            )
          }
        }
      }
    }
  }

  return NextResponse.json({ success: true, ukHour, currentMinutes })
}
'@
[System.IO.File]::WriteAllText("C:\vantro\app\api\notifications\cron\route.ts", $cron, [System.Text.UTF8Encoding]::new($false))
Write-Host "4/8 Cron updated (sign-out time reminders every 15 mins + auto-zero)" -ForegroundColor Green

# ─── 5. UPDATE VERCEL CRON — every 15 mins for sign-out reminders ────
$vercelJson = @'
{
  "crons": [
    {
      "path": "/api/notifications/cron",
      "schedule": "*/15 * * * 1-6"
    }
  ]
}
'@
[System.IO.File]::WriteAllText("C:\vantro\vercel.json", $vercelJson, [System.Text.UTF8Encoding]::new($false))
Write-Host "5/8 Vercel cron updated (every 15 mins)" -ForegroundColor Green

# ─── 5. TIME REPORT API ─────────────────────────────────────────────
New-Item -ItemType Directory -Force -Path "C:\vantro\app\api\admin\time-report" | Out-Null
$timeReport = @'
import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const service = await createServiceClient()
  const { data: u } = await service.from("users").select("company_id, role").eq("auth_user_id", user.id).single()
  if (!u || !["admin", "foreman"].includes(u.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const startDate = searchParams.get("start") || new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0]
  const endDate = searchParams.get("end") || new Date().toISOString().split("T")[0]

  const { data: signins } = await service.from("signins")
    .select("*, users(name, initials), jobs(name, address, lat, lng)")
    .eq("company_id", u.company_id)
    .gte("signed_in_at", startDate + "T00:00:00Z")
    .lte("signed_in_at", endDate + "T23:59:59Z")
    .order("signed_in_at", { ascending: false })

  // Group by user for summary
  const byUser: Record<string, any> = {}
  for (const s of signins || []) {
    const uid = s.user_id
    if (!byUser[uid]) {
      byUser[uid] = {
        user_id: uid,
        name: (s.users as any)?.name,
        initials: (s.users as any)?.initials,
        total_hours: 0,
        total_days: 0,
        flagged_count: 0,
        auto_closed_count: 0,
        early_departure_count: 0,
        early_departure_minutes_total: 0,
        entries: [],
      }
    }
    byUser[uid].entries.push(s)
    byUser[uid].total_hours += s.hours_worked || 0
    byUser[uid].total_days += 1
    if (s.flagged) byUser[uid].flagged_count += 1
    if (s.auto_closed) byUser[uid].auto_closed_count += 1
    if (s.departed_early) byUser[uid].early_departure_count += 1
    byUser[uid].early_departure_minutes_total += s.early_departure_minutes || 0
  }

  // Calculate compliance score per installer
  const summaryWithCompliance = Object.values(byUser).map((u: any) => {
    const totalEntries = u.total_days
    const cleanEntries = totalEntries - u.flagged_count - u.early_departure_count
    const complianceScore = totalEntries > 0 ? Math.round((cleanEntries / totalEntries) * 100) : 100
    return {
      ...u,
      early_departure_count: u.early_departure_count || 0,
      early_departure_minutes_total: u.early_departure_minutes_total || 0,
      compliance_score: complianceScore,
    }
  })

  return NextResponse.json({
    signins: signins || [],
    summary: summaryWithCompliance,
    period: { start: startDate, end: endDate },
  })
}
'@
[System.IO.File]::WriteAllText("C:\vantro\app\api\admin\time-report\route.ts", $timeReport, [System.Text.UTF8Encoding]::new($false))
Write-Host "6/8 Time report API created" -ForegroundColor Green

# ─── 6. BREADCRUMB TRAIL API (for admin map view) ───────────────────
New-Item -ItemType Directory -Force -Path "C:\vantro\app\api\admin\breadcrumbs" | Out-Null
$breadcrumbs = @'
import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const service = await createServiceClient()
  const { data: u } = await service.from("users").select("company_id, role").eq("auth_user_id", user.id).single()
  if (!u || !["admin", "foreman"].includes(u.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const signinId = searchParams.get("signinId")
  const userId = searchParams.get("userId")
  const date = searchParams.get("date") || new Date().toISOString().split("T")[0]

  if (signinId) {
    // Get breadcrumbs for a specific signin
    const { data: logs } = await service.from("location_logs")
      .select("*")
      .eq("signin_id", signinId)
      .eq("company_id", u.company_id)
      .order("logged_at", { ascending: true })

    return NextResponse.json({ logs: logs || [] })
  }

  if (userId) {
    // Get all breadcrumbs for a user on a date
    const { data: logs } = await service.from("location_logs")
      .select("*")
      .eq("user_id", userId)
      .eq("company_id", u.company_id)
      .gte("logged_at", date + "T00:00:00Z")
      .lte("logged_at", date + "T23:59:59Z")
      .order("logged_at", { ascending: true })

    return NextResponse.json({ logs: logs || [] })
  }

  return NextResponse.json({ error: "Provide signinId or userId" }, { status: 400 })
}
'@
[System.IO.File]::WriteAllText("C:\vantro\app\api\admin\breadcrumbs\route.ts", $breadcrumbs, [System.Text.UTF8Encoding]::new($false))
Write-Host "7/8 Breadcrumb trail API created" -ForegroundColor Green

# ─── UPDATE ADMIN SIGNINS API to include sign-out data + completed signins ───
$adminSignins = @'
import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const service = await createServiceClient()
  const { data: u } = await service.from("users").select("company_id, role").eq("auth_user_id", user.id).single()
  if (!u || !["admin","foreman"].includes(u.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const date = searchParams.get("date") || new Date().toISOString().split("T")[0]
  const activeOnly = searchParams.get("active") === "true"

  let query = service.from("signins")
    .select("*, users(name, initials), jobs(name, address, lat, lng)")
    .eq("company_id", u.company_id)
    .gte("signed_in_at", date + "T00:00:00Z")
    .lte("signed_in_at", date + "T23:59:59Z")
    .order("signed_in_at", { ascending: false })

  if (activeOnly) {
    query = query.is("signed_out_at", null)
  }

  const { data: signins } = await query
  return NextResponse.json({ signins: signins || [] })
}
'@
[System.IO.File]::WriteAllText("C:\vantro\app\api\admin\signins\route.ts", $adminSignins, [System.Text.UTF8Encoding]::new($false))
Write-Host "8/8 Admin signins API updated (includes completed + sign-out GPS)" -ForegroundColor Green

# ─── COMMIT AND PUSH ────────────────────────────────────────────────
Write-Host ""
Write-Host "Committing and pushing to Vercel..." -ForegroundColor Yellow
cd C:\vantro
git add .
git commit -m "Feature: GPS tracking - sign-out time, early departure detection, 15-min reminders, auto-zero, breadcrumbs, assign-all, time reports"
git push origin master

Write-Host ""
Write-Host "=== BACKEND DONE ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "NEXT STEPS:" -ForegroundColor Yellow
Write-Host "1. Run the SQL migration in Supabase SQL Editor (vantro-gps-tracking-migration.sql)" -ForegroundColor White
Write-Host "2. Wait for Vercel deploy (~3 mins)" -ForegroundColor White
Write-Host "3. Run the mobile app update script (Part 2) for breadcrumb background tracking" -ForegroundColor White
