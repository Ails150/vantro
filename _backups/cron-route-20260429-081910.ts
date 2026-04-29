import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"

async function sendPushNotification(tokens: string[], title: string, body: string, data?: any) {
  if (!tokens || tokens.length === 0) return
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

// Check if a date falls within British Summer Time (last Sunday March - last Sunday October)
function isBST(date: Date): boolean {
  const year = date.getUTCFullYear()
  const marchLastSunday = new Date(Date.UTC(year, 2, 31))
  marchLastSunday.setUTCDate(31 - marchLastSunday.getUTCDay())
  marchLastSunday.setUTCHours(1, 0, 0, 0)
  const octoberLastSunday = new Date(Date.UTC(year, 9, 31))
  octoberLastSunday.setUTCDate(31 - octoberLastSunday.getUTCDay())
  octoberLastSunday.setUTCHours(1, 0, 0, 0)
  return date >= marchLastSunday && date < octoberLastSunday
}

// Haversine distance in metres
function distanceMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// timeoff_guard_helper
// Returns the set of user_ids who are on approved time off today or whose
// company is observing a public holiday. Defensive: empty set on any error.
async function getProtectedUserIds(service: any, companyIds: string[], date: Date): Promise<Set<string>> {
  const protectedIds = new Set<string>()
  if (!companyIds.length) return protectedIds
  const dateStr = date.toISOString().slice(0, 10)
  try {
    const { data: timeOff } = await service
      .from("time_off_entries")
      .select("user_id")
      .in("company_id", companyIds)
      .eq("status", "approved")
      .lte("start_date", dateStr)
      .gte("end_date", dateStr)
    for (const t of timeOff || []) protectedIds.add(t.user_id)

    const { data: companies } = await service
      .from("companies")
      .select("id, country_code")
      .in("id", companyIds)
    const countryByCompany: Record<string, string> = {}
    const countries = new Set<string>()
    for (const c of companies || []) {
      const cc = c.country_code || "GB"
      countryByCompany[c.id] = cc
      countries.add(cc)
    }

    if (countries.size > 0) {
      const { data: holidays } = await service
        .from("public_holidays")
        .select("country_code")
        .in("country_code", Array.from(countries))
        .eq("holiday_date", dateStr)
      const holidayCountries = new Set((holidays || []).map((h: any) => h.country_code))
      if (holidayCountries.size > 0) {
        const affectedCompanies = companyIds.filter(
          (id) => holidayCountries.has(countryByCompany[id])
        )
        if (affectedCompanies.length > 0) {
          const { data: users } = await service
            .from("users")
            .select("id")
            .in("company_id", affectedCompanies)
            .or("is_active.is.null,is_active.eq.true")
          for (const u of users || []) protectedIds.add(u.id)
        }
      }
    }
  } catch (err) {
    console.error("[cron] getProtectedUserIds failed", err)
  }
  return protectedIds
}

// Build the actual scheduled sign-out timestamp for a sign-in.
// Combines the date the installer signed in (in UK time) with the
// expected_sign_out_time (also UK local), then converts back to UTC.
function buildScheduledSignOutAt(signedInAt: string, expectedSignOutTime: string, ukOffsetHours: number): Date {
  const signedIn = new Date(signedInAt)
  // Get the UK-local date of the sign-in
  const ukSignInLocalMs = signedIn.getTime() + ukOffsetHours * 3600000
  const ukDate = new Date(ukSignInLocalMs)
  const yyyy = ukDate.getUTCFullYear()
  const mm = String(ukDate.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(ukDate.getUTCDate()).padStart(2, "0")
  const [h, m] = expectedSignOutTime.split(":").map(Number)
  // Build UK-local timestamp at HH:MM on the sign-in date, then shift to UTC
  const ukLocalMidnightUtc = Date.UTC(yyyy, ukDate.getUTCMonth(), ukDate.getUTCDate())
  const ukLocalTargetMs = ukLocalMidnightUtc + h * 3600000 + m * 60000
  return new Date(ukLocalTargetMs - ukOffsetHours * 3600000)
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const service = await createServiceClient()
  const now = new Date()
  const ukOffset = isBST(now) ? 1 : 0

  // UK-local "today" boundaries (used for sign-in reminder logic)
  const ukNowMs = now.getTime() + ukOffset * 3600000
  const ukToday = new Date(ukNowMs)
  ukToday.setUTCHours(0, 0, 0, 0)
  const todayUtcMidnight = new Date(ukToday.getTime() - ukOffset * 3600000)
  const utcHour = now.getUTCHours()
  const utcMinute = now.getUTCMinutes()
  const ukHour = (utcHour + ukOffset) % 24
  const currentMinutesUkLocal = ukHour * 60 + utcMinute

  const results: any = {
    ukHour,
    currentMinutesUkLocal,
    reminders_sent: 0,
    admin_alerts: 0,
    auto_closed: 0,
    time_off_skipped: 0,
  }

  // === SIGN-IN REMINDERS: check upcoming shifts ===
  const { data: activeJobs } = await service
    .from("jobs")
    .select("id, name, start_time, company_id")
    .eq("status", "active")
    .not("start_time", "is", null)

  // timeoff_guard_loop
  if (activeJobs && activeJobs.length > 0) {
    const companyIds = Array.from(new Set(activeJobs.map((j: any) => j.company_id)))
    const protectedIds = await getProtectedUserIds(service, companyIds, todayUtcMidnight)

    for (const job of activeJobs) {
      const [h, m] = job.start_time.split(":").map(Number)
      const jobMinutes = h * 60 + m
      if (jobMinutes > currentMinutesUkLocal && jobMinutes <= currentMinutesUkLocal + 30) {
        const minutesUntil = jobMinutes - currentMinutesUkLocal
        const { data: assignments } = await service
          .from("job_assignments")
          .select("user_id, users(name, push_token)")
          .eq("job_id", job.id)
        if (!assignments) continue
        const { data: signins } = await service
          .from("signins")
          .select("user_id")
          .eq("job_id", job.id)
          .gte("signed_in_at", todayUtcMidnight.toISOString())
        const signedInIds = new Set((signins || []).map((s: any) => s.user_id))
        for (const assignment of assignments) {
          const user = assignment.users as any
          if (!user?.push_token || signedInIds.has(assignment.user_id)) continue
          if (protectedIds.has(assignment.user_id)) {
            results.time_off_skipped = (results.time_off_skipped || 0) + 1
            continue
          }
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

  // === SIGN-OUT PROCESSING ===
  // Process every active sign-in regardless of how old it is.
  // Compute "minutes past expected sign-out" using the sign-in's OWN date,
  // not "today's clock". This is the bug fix: previously a Friday sign-in
  // checked Friday's expected_sign_out_time vs Monday's "now", which is meaningless.
  const { data: activeSignins } = await service
    .from("signins")
    .select("id, user_id, job_id, company_id, signed_in_at, expected_sign_out_time, reminder_sent_at, admin_reminder_sent_at, jobs(name, lat, lng, company_id), users(name, push_token)")
    .is("signed_out_at", null)

  if (activeSignins && activeSignins.length > 0) {
    for (const signin of activeSignins) {
      const user = signin.users as any
      const job = signin.jobs as any
      if (!signin.expected_sign_out_time) continue

      // Build the actual scheduled sign-out timestamp from the sign-in's date
      const scheduledSignOutAt = buildScheduledSignOutAt(
        signin.signed_in_at,
        signin.expected_sign_out_time,
        ukOffset
      )
      const minutesPastSignOut = Math.floor(
        (now.getTime() - scheduledSignOutAt.getTime()) / 60000
      )

      // INSTALLER REMINDER: fire once within 0-15 min past sign-out time
      if (minutesPastSignOut >= 0 && minutesPastSignOut < 20 && !signin.reminder_sent_at && user?.push_token) {
        const [soh, som] = signin.expected_sign_out_time.split(":").map(Number)
        const timeStr = `${soh.toString().padStart(2, "0")}:${som.toString().padStart(2, "0")}`
        await sendPushNotification(
          [user.push_token],
          "Time to sign out",
          `Your shift at ${job?.name} ended at ${timeStr}. Please sign out now.`,
          { type: "signout_reminder", jobId: signin.job_id }
        )
        await service.from("signins").update({ reminder_sent_at: now.toISOString() }).eq("id", signin.id)
        results.reminders_sent++
      }

      // ADMIN ALERT: 30+ min past sign-out, fire once
      if (minutesPastSignOut >= 30 && !signin.admin_reminder_sent_at) {
        const { data: admins } = await service.from("users")
          .select("push_token, email, name")
          .eq("company_id", signin.company_id)
          .in("role", ["admin", "foreman"])

        const adminTokens = (admins || []).map((a: any) => a.push_token).filter(Boolean)
        if (adminTokens.length > 0) {
          await sendPushNotification(
            adminTokens,
            "Installer past sign-out",
            `${user?.name} has not signed out of ${job?.name} - scheduled ${signin.expected_sign_out_time}`,
            { type: "admin_past_signout", signinId: signin.id }
          )
        }
        await service.from("signins").update({ admin_reminder_sent_at: now.toISOString() }).eq("id", signin.id)
        results.admin_alerts++
      }

      // AUTO-CLOSE: 2+ hours past sign-out
      if (minutesPastSignOut >= 120) {
        // Default: close at the scheduled sign-out timestamp (correct date)
        let closeAt = scheduledSignOutAt
        let closeReason = "auto_scheduled"

        if (job?.lat && job?.lng) {
          const { data: breadcrumbs } = await service
            .from("location_logs")
            .select("lat, lng, logged_at")
            .eq("user_id", signin.user_id)
            .gte("logged_at", signin.signed_in_at)
            .order("logged_at", { ascending: false })
            .limit(100)

          if (breadcrumbs && breadcrumbs.length > 0) {
            // Find most recent breadcrumb where they were on site
            const lastOnSite = breadcrumbs.find((b: any) => {
              const dist = distanceMetres(b.lat, b.lng, job.lat, job.lng)
              return dist <= 150
            })
            if (lastOnSite) {
              const lastOnSiteTime = new Date(lastOnSite.logged_at)
              // Use last-on-site if it's earlier than scheduled sign-out
              if (lastOnSiteTime < closeAt) {
                closeAt = lastOnSiteTime
                closeReason = "auto_last_onsite"
              }
            }
          }
        }

        const hoursWorked = Math.max(0, (closeAt.getTime() - new Date(signin.signed_in_at).getTime()) / 3600000)

        await service.from("signins").update({
          signed_out_at: closeAt.toISOString(),
          hours_worked: parseFloat(hoursWorked.toFixed(2)),
          auto_closed: true,
          auto_closed_reason: closeReason,
          flagged: true,
          flag_reason: `No sign-out received. Closed at ${closeReason === "auto_last_onsite" ? "the last GPS point on-site" : "the scheduled sign-out time"}. Please review hours.`,
        }).eq("id", signin.id)

        if (user?.push_token) {
          await sendPushNotification(
            [user.push_token],
            "Shift auto-closed",
            `Your shift at ${job?.name} was auto-closed. Please speak to your manager if incorrect.`,
            { type: "auto_cutoff", jobId: signin.job_id }
          )
        }

        const { data: admins } = await service.from("users")
          .select("push_token")
          .eq("company_id", signin.company_id)
          .in("role", ["admin", "foreman"])
        const adminTokens = (admins || []).map((a: any) => a.push_token).filter(Boolean)
        if (adminTokens.length > 0) {
          await sendPushNotification(
            adminTokens,
            "Auto-closed shift needs review",
            `${user?.name} didn't sign out of ${job?.name}. Closed at ${closeAt.toISOString()}. Review in admin.`,
            { type: "admin_auto_cutoff", signinId: signin.id }
          )
        }
        results.auto_closed++
      }
    }
  }

  return NextResponse.json({ success: true, ...results })
}
