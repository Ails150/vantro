// Shared notification engine used by both /api/notifications/cron (real run)
// and /api/notifications/cron-debug (dry run).
//
// The only difference between the two is `dryRun`: when true, the engine
// records what it WOULD do but doesn't send pushes, doesn't write to the DB.
//
// Architecture change vs the old monolithic cron:
//   - Group jobs and sign-ins by company
//   - For each company, compute "now" in that company's IANA timezone
//   - Run all reminder logic in local time per-company
//
// This removes every UK-hardcoded assumption.

import { combineDateAndLocalTime, nowInTimezone, type LocalNow } from "./timezone"

type Service = any // SupabaseClient â€” typed as any to avoid SDK version coupling

export type EngineResult = {
  dryRun: boolean
  now_utc: string
  companies_processed: number
  reminders_sent: number
  admin_alerts: number
  auto_closed: number
  time_off_skipped: number
  duplicate_skipped: number
  per_company: Array<{
    company_id: string
    tz: string
    local_time: string
    local_date: string
    signin_reminders: Array<{ job: string; user: string; minutesUntil: number; localStart: string; sent: boolean; reason?: string }>
    signout_reminders: Array<{ user: string; job: string; minutesPast: number; sent: boolean; reason?: string }>
    auto_closed: Array<{ user: string; job: string; closeAt: string; reason: string }>
    time_off_skipped: Array<{ user: string; job: string; reason: string }>
  }>
}

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

function distanceMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// Returns the set of user_ids who are on approved time off today (in their
// company's local date) or whose company is observing a public holiday.
async function getProtectedUserIds(
  service: Service,
  companyId: string,
  localDateStr: string,
): Promise<Set<string>> {
  const protectedIds = new Set<string>()
  try {
    const { data: timeOff } = await service
      .from("time_off_entries")
      .select("user_id")
      .eq("company_id", companyId)
      .eq("status", "approved")
      .lte("start_date", localDateStr)
      .gte("end_date", localDateStr)
    for (const t of timeOff || []) protectedIds.add(t.user_id)

    const { data: company } = await service
      .from("companies")
      .select("country_code")
      .eq("id", companyId)
      .single()
    const cc = company?.country_code || "GB"

    const { data: holiday } = await service
      .from("public_holidays")
      .select("country_code")
      .eq("country_code", cc)
      .eq("holiday_date", localDateStr)
      .maybeSingle()

    if (holiday) {
      const { data: users } = await service
        .from("users")
        .select("id")
        .eq("company_id", companyId)
        .or("is_active.is.null,is_active.eq.true")
      for (const u of users || []) protectedIds.add(u.id)
    }
  } catch (err) {
    console.error("[cron] getProtectedUserIds failed", { companyId, err })
  }
  return protectedIds
}

export async function runNotificationEngine(
  service: Service,
  opts: { dryRun: boolean; now?: Date },
): Promise<EngineResult> {
  const dryRun = !!opts.dryRun
  const now = opts.now ?? new Date()

  const result: EngineResult = {
    dryRun,
    now_utc: now.toISOString(),
    companies_processed: 0,
    reminders_sent: 0,
    admin_alerts: 0,
    auto_closed: 0,
    time_off_skipped: 0,
    duplicate_skipped: 0,
    per_company: [],
  }

  // Fetch every company that has either an active job with a start_time
  // or an open sign-in. We need their timezone to do anything.
  const { data: companies } = await service
    .from("companies")
    .select("id, timezone")

  if (!companies || companies.length === 0) {
    return result
  }

  for (const company of companies) {
    const tz = company.timezone || "Europe/London"
    const local = nowInTimezone(tz, now)
    const companyResult = {
      company_id: company.id,
      tz,
      local_time: `${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}`,
      local_date: local.dateStr,
      signin_reminders: [] as any[],
      signout_reminders: [] as any[],
      auto_closed: [] as any[],
      time_off_skipped: [] as any[],
    }

    // Build protected-user set once per company
    const protectedIds = await getProtectedUserIds(service, company.id, local.dateStr)

    // â”€â”€ SIGN-IN REMINDERS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Window: minutesUntil > 15 && <= 30 â†’ exactly one reminder per shift,
    // assuming cron runs every 15 min. No duplicates.
    const { data: jobs } = await service
      .from("jobs")
      .select("id, name, start_time, last_signin_reminder_date")
      .eq("company_id", company.id)
      .eq("status", "active")
      .not("start_time", "is", null)

    for (const job of jobs || []) {
      const [h, m] = job.start_time.split(":").map(Number)
      const jobMinutes = h * 60 + m
      const minutesUntil = jobMinutes - local.minutesOfDay
      const localStart = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`

      if (minutesUntil <= 15 || minutesUntil > 30) continue

      // Idempotency: only one reminder batch per job per local-date
      if (job.last_signin_reminder_date === local.dateStr) {
        result.duplicate_skipped++
        continue
      }

      const { data: assignments } = await service
        .from("job_assignments")
        .select("user_id, users(name, push_token)")
        .eq("job_id", job.id)
      if (!assignments || assignments.length === 0) continue

      const { data: signins } = await service
        .from("signins")
        .select("user_id")
        .eq("job_id", job.id)
        .gte("signed_in_at", local.todayUtcMidnight.toISOString())
      const signedInIds = new Set((signins || []).map((s: any) => s.user_id))

      let anyReminderQueued = false
      for (const a of assignments) {
        const user = a.users as any
        if (!user?.push_token || signedInIds.has(a.user_id)) continue
        if (protectedIds.has(a.user_id)) {
          companyResult.time_off_skipped.push({ user: user.name, job: job.name, reason: "time_off_or_holiday" })
          result.time_off_skipped++
          continue
        }
        companyResult.signin_reminders.push({
          job: job.name,
          user: user.name,
          minutesUntil,
          localStart,
          sent: !dryRun,
        })
        anyReminderQueued = true
        if (!dryRun) {
          await sendPushNotification(
            [user.push_token],
            "Shift reminder",
            `Your shift at ${job.name} starts in ${minutesUntil} minute${minutesUntil !== 1 ? "s" : ""}`,
            { type: "signin_reminder", jobId: job.id },
          )
          result.reminders_sent++
        }
      }

      // Mark this job's reminder batch as sent for the day so subsequent cron
      // runs in the same window don't re-fire (defence in depth alongside the
      // 15-min window math).
      if (anyReminderQueued && !dryRun) {
        await service.from("jobs")
          .update({ last_signin_reminder_date: local.dateStr })
          .eq("id", job.id)
      }
    }

    // â”€â”€ SIGN-OUT REMINDERS + AUTO-CLOSE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const { data: activeSignins } = await service
      .from("signins")
      .select("id, user_id, job_id, company_id, signed_in_at, expected_sign_out_time, reminder_sent_at, admin_reminder_sent_at, jobs(name, lat, lng), users(name, push_token)")
      .eq("company_id", company.id)
      .is("signed_out_at", null)
      .limit(200)

    for (const signin of activeSignins || []) {
      const user = signin.users as any
      const job = signin.jobs as any
      if (!signin.expected_sign_out_time) continue

      const scheduledSignOutAt = combineDateAndLocalTime(
        signin.signed_in_at,
        signin.expected_sign_out_time,
        tz,
      )
      const minutesPastSignOut = Math.floor(
        (now.getTime() - scheduledSignOutAt.getTime()) / 60000,
      )

      // INSTALLER REMINDER: 0-19 min past sign-out, fire once
      if (
        minutesPastSignOut >= 0 &&
        minutesPastSignOut < 20 &&
        !signin.reminder_sent_at &&
        user?.push_token
      ) {
        companyResult.signout_reminders.push({
          user: user?.name,
          job: job?.name,
          minutesPast: minutesPastSignOut,
          sent: !dryRun,
        })
        if (!dryRun) {
          await sendPushNotification(
            [user.push_token],
            "Time to sign out",
            `Your shift at ${job?.name} ended at ${signin.expected_sign_out_time}. Please sign out now.`,
            { type: "signout_reminder", jobId: signin.job_id },
          )
          await service.from("signins").update({ reminder_sent_at: now.toISOString() }).eq("id", signin.id)
          result.reminders_sent++
        }
      }

      // ADMIN ALERT: 30+ min past, once
      if (minutesPastSignOut >= 30 && !signin.admin_reminder_sent_at) {
        if (!dryRun) {
          const { data: admins } = await service.from("users")
            .select("push_token")
            .eq("company_id", company.id)
            .in("role", ["admin", "foreman"])
          const adminTokens = (admins || []).map((a: any) => a.push_token).filter(Boolean)
          if (adminTokens.length > 0) {
            await sendPushNotification(
              adminTokens,
              "Installer past sign-out",
              `${user?.name} has not signed out of ${job?.name} - scheduled ${signin.expected_sign_out_time}`,
              { type: "admin_past_signout", signinId: signin.id },
            )
          }
          await service.from("signins").update({ admin_reminder_sent_at: now.toISOString() }).eq("id", signin.id)
          result.admin_alerts++
        }
      }

      // AUTO-CLOSE: 2+ hours past
      if (minutesPastSignOut >= 120) {
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

          const lastOnSite = (breadcrumbs || []).find((b: any) => {
            const dist = distanceMetres(b.lat, b.lng, job.lat, job.lng)
            return dist <= 150
          })
          if (lastOnSite) {
            // Industry standard: pay for actual time on site.
            // Use last on-site GPS point regardless of whether it is before
            // or after the scheduled finish - this protects installer pay
            // (no lost overtime) and prevents overpayment if they left early.
            // Always flagged so admin reviews and approves payroll.
            const lastOnSiteTime = new Date(lastOnSite.logged_at)
            closeAt = lastOnSiteTime
            closeReason = "auto_last_onsite"
          }
        }

        const hoursWorked = Math.max(
          0,
          (closeAt.getTime() - new Date(signin.signed_in_at).getTime()) / 3600000,
        )

        companyResult.auto_closed.push({
          user: user?.name,
          job: job?.name,
          closeAt: closeAt.toISOString(),
          reason: closeReason,
        })

        if (!dryRun) {
          await service.from("signins").update({
            signed_out_at: closeAt.toISOString(),
            hours_worked: parseFloat(hoursWorked.toFixed(2)),
            auto_closed: true,
            auto_closed_reason: closeReason,
            flagged: true,
            flag_reason: `No sign-out received. Closed at ${closeReason === "auto_last_onsite" ? "the last GPS point on-site (actual time worked)" : "the scheduled sign-out time (no GPS data available)"}. Please review hours.`,
          }).eq("id", signin.id)

          if (user?.push_token) {
            await sendPushNotification(
              [user.push_token],
              "Shift auto-closed",
              `Your shift at ${job?.name} was auto-closed. Please speak to your manager if incorrect.`,
              { type: "auto_cutoff", jobId: signin.job_id },
            )
          }
          const { data: admins } = await service.from("users")
            .select("push_token")
            .eq("company_id", company.id)
            .in("role", ["admin", "foreman"])
          const adminTokens = (admins || []).map((a: any) => a.push_token).filter(Boolean)
          if (adminTokens.length > 0) {
            await sendPushNotification(
              adminTokens,
              "Auto-closed shift needs review",
              `${user?.name} didn't sign out of ${job?.name}. Closed at ${closeAt.toISOString()}.`,
              { type: "admin_auto_cutoff", signinId: signin.id },
            )
          }
          result.auto_closed++
        }
      }
    }

    result.per_company.push(companyResult)
    result.companies_processed++
  }

  return result
}
