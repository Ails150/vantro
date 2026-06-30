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
import { isInstallerWorking } from "./resolver"

type Service = any // SupabaseClient - typed as any to avoid SDK version coupling

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
  opts: { dryRun: boolean; now?: Date; onlyCompanyId?: string },
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
  // opts.onlyCompanyId scopes the whole run to a single company - used by the
  // local-only test harness so a test run can never touch other companies' data.
  let companiesQuery = service.from("companies").select("id, timezone")
  if (opts.onlyCompanyId) {
    companiesQuery = companiesQuery.eq("id", opts.onlyCompanyId)
  }
  const { data: companies } = await companiesQuery

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

    // - SIGN-IN REMINDERS (10 min before scheduled start) -
    // Window: minutesUntil > 5 && <= 10 - exactly one reminder per shift,
    // assuming cron runs every 5 min. Half-open window of width 5 guarantees
    // exactly one cron tick lands in it. Idempotency flag below is defence in depth.
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

      if (minutesUntil <= 5 || minutesUntil > 10) continue

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
        // Per-user working-day check - skip if today is a day off, holiday,
        // time off, or user has no schedule. Catches cases protectedIds misses
        // (notably users whose weekly schedule says day_off but who don't have
        // a time_off_entry row).
        try {
          const userState = await isInstallerWorking(a.user_id, now)
          if (
            userState.reason === "day_off" ||
            userState.reason === "public_holiday" ||
            userState.reason === "time_off" ||
            userState.reason === "no_schedule"
          ) {
            companyResult.time_off_skipped.push({ user: user.name, job: job.name, reason: userState.reason })
            result.time_off_skipped++
            continue
          }
        } catch (e) {
          console.error("[cron] resolver check failed", { userId: a.user_id, err: e })
          // Fail safe: if resolver errors, fall through and reminder fires.
          // Better to over-notify than block legitimate reminders.
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

    // - END-OF-SHIFT NOTIFICATION + SIGN-OUT REMINDER + AUTO SIGN-OUT -
    // Pure time-based sequence (no GPS). Relative to the scheduled sign-out time:
    //   minutesPast in [0, 5)   -> end-of-shift push          (once, via end_notif_sent_at)
    //   minutesPast in [15, 20) -> sign-out reminder push     (once, via reminder_sent_at)
    //   minutesPast >= 30       -> auto sign-out (close at scheduled end, flag, notify)
    // Each window is half-open and >= the 5-min cron interval, so exactly one
    // tick lands in it; the idempotency columns are defence in depth.
    const { data: activeSignins } = await service
      .from("signins")
      .select("id, user_id, job_id, company_id, signed_in_at, expected_sign_out_time, reminder_sent_at, end_notif_sent_at, jobs(name), users(name, push_token)")
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

      // 1. END-OF-SHIFT: fired right at the scheduled end time.
      if (
        minutesPastSignOut >= 0 &&
        minutesPastSignOut < 5 &&
        !signin.end_notif_sent_at &&
        user?.push_token
      ) {
        companyResult.signout_reminders.push({
          user: user?.name,
          job: job?.name,
          minutesPast: minutesPastSignOut,
          sent: !dryRun,
          reason: "end_of_shift",
        })
        if (!dryRun) {
          await sendPushNotification(
            [user.push_token],
            "Shift ended",
            `Your shift at ${job?.name} has ended (${signin.expected_sign_out_time}). Please sign out.`,
            { type: "end_of_shift", jobId: signin.job_id },
          )
          await service.from("signins").update({ end_notif_sent_at: now.toISOString() }).eq("id", signin.id)
          result.reminders_sent++
        }
      }

      // 2. SIGN-OUT REMINDER: 15 min after end, only if still not signed out.
      if (
        minutesPastSignOut >= 15 &&
        minutesPastSignOut < 20 &&
        !signin.reminder_sent_at &&
        user?.push_token
      ) {
        companyResult.signout_reminders.push({
          user: user?.name,
          job: job?.name,
          minutesPast: minutesPastSignOut,
          sent: !dryRun,
          reason: "signout_reminder",
        })
        if (!dryRun) {
          await sendPushNotification(
            [user.push_token],
            "Time to sign out",
            `You still haven't signed out from ${job?.name}. You'll be signed out automatically in 15 minutes.`,
            { type: "signout_reminder", jobId: signin.job_id },
          )
          await service.from("signins").update({ reminder_sent_at: now.toISOString() }).eq("id", signin.id)
          result.reminders_sent++
        }
      }

      // 3. AUTO SIGN-OUT: 30+ min past end. Clock out at the SCHEDULED end time
      // (not the 30-min detection time) so payroll reflects actual shift hours.
      if (minutesPastSignOut >= 30) {
        const closeAt = scheduledSignOutAt
        const hoursWorked = Math.max(
          0,
          (closeAt.getTime() - new Date(signin.signed_in_at).getTime()) / 3600000,
        )

        companyResult.auto_closed.push({
          user: user?.name,
          job: job?.name,
          closeAt: closeAt.toISOString(),
          reason: "auto_no_signout",
        })

        if (!dryRun) {
          await service.from("signins").update({
            signed_out_at: closeAt.toISOString(),
            hours_worked: parseFloat(hoursWorked.toFixed(2)),
            auto_closed: true,
            auto_closed_reason: "auto_no_signout",
            signed_out_method: "auto",
            flagged: true,
            flag_reason: `Auto signed out - no manual sign-out 30 min after shift end. Hours recorded to the scheduled end time (${signin.expected_sign_out_time}). Please review.`,
          }).eq("id", signin.id)

          // Tell the installer they were auto signed out.
          if (user?.push_token) {
            await sendPushNotification(
              [user.push_token],
              "Signed out automatically",
              `You were automatically signed out from ${job?.name} at ${signin.expected_sign_out_time}. Contact your admin if this is wrong.`,
              { type: "auto_signout", jobId: signin.job_id },
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

