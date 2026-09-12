// Shared notification engine used by both /api/notifications/cron (real run)
// and /api/notifications/cron-debug (dry run).
//
// The only difference between the two is `dryRun`: when true, the engine
// records what it WOULD do but doesn't send pushes, doesn't write to the DB.
//
// Architecture:
//   - Group jobs and sign-ins by company
//   - For each company, compute "now" in that company's IANA timezone
//   - Run all reminder logic in local time per-company
//   - Take every send/suppress decision in lib/notifications/rules.ts, which is
//     pure and unit-tested, and write the decision AND its reason to
//     notification_log whichever way it went
//
// WHAT CHANGED, 2026-09-12
// A worker was pushed "signed out automatically" roughly every five minutes for
// a day and a half. Four separate faults, all fixed here or in the migrations
// alongside:
//
//   1. The auto sign-out UPDATE was being rejected by the evidence write-once
//      trigger (see 20260912090000) and nobody checked the error, so the shift
//      stayed open and the same push re-fired on every tick, forever. Every
//      state write in this file is now error-checked, and the push only goes
//      out if the write that should have stopped it actually landed.
//   2. Sign-in reminders keyed off jobs.start_time alone and never asked
//      whether the WORKER was rostered that day. The weekend guard lived in a
//      resolver that read the server's clock and ignored users.weekly_schedule.
//   3. "Already signed in" was scoped to the one job, so an open shift on
//      another job did not suppress a reminder.
//   4. The reminder idempotency flag lived on the job, so the first worker
//      reminded silenced every other worker assigned to it.

import { combineDateAndLocalTime, nowInTimezone } from "./timezone"
import {
  DEFAULT_QUIET_HOURS,
  SIGNIN_REMINDER_EARLIEST,
  SIGNIN_REMINDER_LATEST,
  evaluateGeofenceAutoSignout,
  isJobNotifiable,
  isPushAllowed,
  parseHhmm,
  resolveScheduledDay,
  shouldSendSigninReminder,
  type QuietHours,
  type ScheduledDay,
} from "@/lib/notifications/rules"

type Service = any // SupabaseClient - typed as any to avoid SDK version coupling

export type NotificationKind =
  | "signin_reminder"
  | "end_of_shift"
  | "signout_reminder"
  | "auto_signout"

export type EngineResult = {
  dryRun: boolean
  now_utc: string
  companies_processed: number
  reminders_sent: number
  admin_alerts: number
  auto_closed: number
  time_off_skipped: number
  duplicate_skipped: number
  suppressed: number
  per_company: Array<{
    company_id: string
    tz: string
    local_time: string
    local_date: string
    quiet: QuietHours
    signin_reminders: Array<Record<string, any>>
    signout_reminders: Array<Record<string, any>>
    auto_closed: Array<Record<string, any>>
    time_off_skipped: Array<Record<string, any>>
    suppressed: Array<Record<string, any>>
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

type LogEntry = {
  companyId: string
  userId: string
  jobId?: string | null
  signinId?: string | null
  kind: NotificationKind
  dedupeKey: string
  sent: boolean
  reason: string
  title?: string | null
  body?: string | null
  context?: Record<string, any>
}

/**
 * Record the decision. Suppressions are logged too -- they are the evidence
 * that a quiet weekend was a rule firing rather than a broken cron.
 *
 * Best-effort by design: a log write that fails must not stop a shift being
 * closed. But it is logged loudly, because the dedupe guarantee for sends
 * rests on this row landing.
 */
async function recordDecision(service: Service, dryRun: boolean, entry: LogEntry) {
  if (dryRun) return
  const { error } = await service.from("notification_log").insert({
    company_id: entry.companyId,
    user_id: entry.userId,
    job_id: entry.jobId ?? null,
    signin_id: entry.signinId ?? null,
    kind: entry.kind,
    dedupe_key: entry.dedupeKey,
    sent: entry.sent,
    reason: entry.reason,
    title: entry.title ?? null,
    body: entry.body ?? null,
    context: entry.context ?? null,
  })
  if (error) {
    console.error("[cron] notification_log insert failed", { kind: entry.kind, error })
  }
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

/** Sent notifications for this company since `sinceIso`, as "kind:dedupe_key". */
async function getAlreadySent(
  service: Service,
  companyId: string,
  sinceIso: string,
): Promise<Set<string>> {
  const seen = new Set<string>()
  const { data, error } = await service
    .from("notification_log")
    .select("kind, dedupe_key")
    .eq("company_id", companyId)
    .eq("sent", true)
    .gte("created_at", sinceIso)
  if (error) {
    // Fail CLOSED. If we cannot prove a notification has not already gone out,
    // we do not send it. The old code failed open on every uncertainty and that
    // is exactly how it ended up sending the same push 170 times.
    console.error("[cron] notification_log read failed - suppressing this tick", error)
    return new Set(["__unavailable__"])
  }
  for (const row of data || []) seen.add(`${row.kind}:${row.dedupe_key}`)
  return seen
}

function quietHoursFor(company: any): QuietHours {
  return {
    start: company?.notification_quiet_start ?? DEFAULT_QUIET_HOURS.start,
    end: company?.notification_quiet_end ?? DEFAULT_QUIET_HOURS.end,
    weekendPush: company?.notification_weekend_push ?? DEFAULT_QUIET_HOURS.weekendPush,
  }
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
    suppressed: 0,
    per_company: [],
  }

  // opts.onlyCompanyId scopes the whole run to a single company - used by the
  // local-only test harness so a test run can never touch other companies' data.
  let companiesQuery = service
    .from("companies")
    .select(
      "id, timezone, default_schedule, notification_quiet_start, notification_quiet_end, notification_weekend_push",
    )
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
    const quiet = quietHoursFor(company)
    const companyResult = {
      company_id: company.id,
      tz,
      local_time: `${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}`,
      local_date: local.dateStr,
      quiet,
      signin_reminders: [] as any[],
      signout_reminders: [] as any[],
      auto_closed: [] as any[],
      time_off_skipped: [] as any[],
      suppressed: [] as any[],
    }

    const noteSuppressed = (row: Record<string, any>) => {
      companyResult.suppressed.push(row)
      result.suppressed++
    }

    const protectedIds = await getProtectedUserIds(service, company.id, local.dateStr)
    // 36 hours back covers the longest dedupe key in play (a per-local-date
    // sign-in reminder) across any timezone, without scanning the whole table.
    const alreadySent = await getAlreadySent(
      service,
      company.id,
      new Date(now.getTime() - 36 * 3600000).toISOString(),
    )
    const logUnavailable = alreadySent.has("__unavailable__")

    // Every worker with an OPEN shift, on any job. Used to answer "is this
    // person already signed in" without scoping the question to one job, which
    // is how a reminder could fire at someone who was already on site.
    const { data: openSignins } = await service
      .from("signins")
      .select("user_id")
      .eq("company_id", company.id)
      .is("signed_out_at", null)
    const openSigninUserIds = new Set((openSignins || []).map((s: any) => s.user_id))

    // Per-user schedule lookup, resolved once and reused by every rule below.
    const scheduleCache = new Map<string, ScheduledDay>()
    const scheduleFor = async (userId: string, user: any): Promise<ScheduledDay> => {
      const cached = scheduleCache.get(userId)
      if (cached) return cached
      const { data: shifts } = await service
        .from("user_shifts")
        .select("start_time, end_time")
        .eq("user_id", userId)
        .eq("day_of_week", local.dayIndex)
        .lte("effective_from", local.dateStr)
        .or(`effective_until.is.null,effective_until.gte.${local.dateStr}`)
      const resolved = resolveScheduledDay(local.dayIndex, {
        shifts,
        weeklySchedule: user?.weekly_schedule ?? null,
        workingDays: user?.working_days ?? null,
        companyDefault: company.default_schedule ?? null,
      })
      scheduleCache.set(userId, resolved)
      return resolved
    }

    // ----- SIGN-IN REMINDERS (rule 3) ---------------------------------------
    // Window: shift start minus 15 to shift start plus 30, evaluated in company
    // local time. Only on days the worker is rostered. Once per worker per job
    // per local date, enforced by notification_log.
    //
    // The job query carries rule 4: archived, completed and non-active jobs are
    // excluded in SQL, and isJobNotifiable re-checks in code including the
    // job's own date range, which SQL cannot express against a local date.
    const { data: jobs } = await service
      .from("jobs")
      .select("id, name, status, start_time, start_date, end_date, archived_at, completed_at")
      .eq("company_id", company.id)
      .eq("status", "active")
      .is("archived_at", null)
      .is("completed_at", null)
      .not("start_time", "is", null)

    for (const job of jobs || []) {
      const jobGate = isJobNotifiable(job, local.dateStr)
      if (!jobGate.allowed) {
        noteSuppressed({ kind: "signin_reminder", job: job.name, reason: jobGate.reason })
        continue
      }

      // Rule 4's other half: the notification must be about a job the worker is
      // actually assigned to. The join is the assignment, so an unassigned
      // worker is not reachable from here by construction.
      const { data: assignments } = await service
        .from("job_assignments")
        .select("user_id, users(id, name, push_token, weekly_schedule, working_days)")
        .eq("job_id", job.id)
      if (!assignments || assignments.length === 0) continue

      for (const a of assignments) {
        const user = a.users as any
        if (!user) continue

        const dedupeKey = `signin_reminder:${job.id}:${local.dateStr}`
        const schedule = await scheduleFor(a.user_id, user)
        // The worker's own rostered start wins over the job's nominal start
        // time: the job says when the site opens, the roster says when this
        // person is due.
        const shiftStart = schedule.startTime ?? (job.start_time ? String(job.start_time).slice(0, 5) : null)

        const decision = shouldSendSigninReminder({
          minutesOfDay: local.minutesOfDay,
          dayIndex: local.dayIndex,
          localDateStr: local.dateStr,
          shiftStart,
          scheduled: schedule.scheduled,
          alreadySignedIn: openSigninUserIds.has(a.user_id),
          alreadyReminded: logUnavailable || alreadySent.has(`signin_reminder:${dedupeKey}`),
          hasPushToken: !!user.push_token,
          protectedReason: protectedIds.has(a.user_id) ? "time_off_or_holiday" : null,
          job,
          quiet,
        })

        const context = {
          local_time: companyResult.local_time,
          local_date: local.dateStr,
          day_index: local.dayIndex,
          shift_start: shiftStart,
          schedule_source: schedule.source,
          minutes_from_start: decision.minutesFromStart,
        }

        if (!decision.send) {
          // Only record suppressions for shifts whose reminder window is open
          // right now. Every other tick would otherwise write a row per
          // assignment per five minutes -- 288 a day per worker per job saying
          // "it is not 8am yet", which buries the rows that mean something.
          const startMinutes = parseHhmm(shiftStart)
          const fromStart = startMinutes == null ? null : local.minutesOfDay - startMinutes
          const windowOpen =
            fromStart != null &&
            fromStart >= SIGNIN_REMINDER_EARLIEST &&
            fromStart <= SIGNIN_REMINDER_LATEST

          if (windowOpen) {
            noteSuppressed({ kind: "signin_reminder", job: job.name, user: user.name, reason: decision.reason })
            if (decision.reason === "time_off_or_holiday") result.time_off_skipped++
            if (decision.reason === "already_reminded") result.duplicate_skipped++
            await recordDecision(service, dryRun, {
              companyId: company.id,
              userId: a.user_id,
              jobId: job.id,
              kind: "signin_reminder",
              dedupeKey,
              sent: false,
              reason: decision.reason,
              context,
            })
          }
          continue
        }

        const title = "Time to sign in"
        const minutesFromStart = decision.minutesFromStart ?? 0
        const body =
          minutesFromStart < 0
            ? `Your shift at ${job.name} starts in ${Math.abs(minutesFromStart)} minute${Math.abs(minutesFromStart) !== 1 ? "s" : ""}.`
            : `Your shift at ${job.name} has started. Please sign in.`

        companyResult.signin_reminders.push({
          job: job.name,
          user: user.name,
          minutesFromStart,
          shiftStart,
          sent: !dryRun,
        })

        if (dryRun) continue

        // Claim the dedupe key BEFORE sending. The unique index on sent rows is
        // what makes "once per shift" true even if two ticks overlap; losing
        // the race means someone else already sent it, so we must not.
        const { error: claimErr } = await service.from("notification_log").insert({
          company_id: company.id,
          user_id: a.user_id,
          job_id: job.id,
          kind: "signin_reminder",
          dedupe_key: dedupeKey,
          sent: true,
          reason: decision.reason,
          title,
          body,
          context,
        })
        if (claimErr) {
          console.warn("[cron] signin reminder not sent, dedupe claim failed", {
            job: job.id,
            user: a.user_id,
            error: claimErr.message,
          })
          result.duplicate_skipped++
          continue
        }

        await sendPushNotification([user.push_token], title, body, {
          type: "signin_reminder",
          jobId: job.id,
        })
        result.reminders_sent++
      }
    }

    // ----- END OF SHIFT, SIGN-OUT REMINDER, AUTO SIGN-OUT -------------------
    // Relative to the scheduled sign-out time:
    //   minutesPast in [0, 5)   -> end-of-shift push
    //   minutesPast in [15, 20) -> sign-out reminder push
    //   minutesPast >= 30       -> auto sign-out (close at the scheduled end)
    // plus, independently of the clock, the geofence dwell rule.
    //
    // Every one of these is now gated on the notification_log dedupe key rather
    // than on a column the UPDATE might have failed to write, and the push for
    // the auto sign-out is sent only after the close is confirmed.
    const { data: activeSignins } = await service
      .from("signins")
      .select(
        "id, user_id, job_id, company_id, signed_in_at, expected_sign_out_time, " +
          "jobs(id, name, status, archived_at, completed_at, start_date, end_date), " +
          "users(id, name, push_token, weekly_schedule, working_days)",
      )
      .eq("company_id", company.id)
      .is("signed_out_at", null)
      .limit(200)

    for (const signin of activeSignins || []) {
      const user = signin.users as any
      const job = signin.jobs as any

      // Rule 4 again: no notification about a job that is archived or done.
      // The shift is still closed if it needs closing -- payroll does not stop
      // mattering because someone archived the job -- but nobody is pushed.
      const jobGate = job
        ? isJobNotifiable(job, local.dateStr)
        : { allowed: false, reason: "job_missing" }

      const schedule = await scheduleFor(signin.user_id, user)
      const gate = isPushAllowed({
        minutesOfDay: local.minutesOfDay,
        dayIndex: local.dayIndex,
        scheduledToday: schedule.scheduled,
        quiet,
      })

      /** Send, unless a rule says otherwise. Always records why. */
      const deliver = async (
        kind: NotificationKind,
        dedupeKey: string,
        title: string,
        body: string,
        context: Record<string, any>,
      ): Promise<boolean> => {
        const base = {
          companyId: company.id,
          userId: signin.user_id,
          jobId: signin.job_id,
          signinId: signin.id,
          kind,
          dedupeKey,
          title,
          body,
          context,
        }
        const refuse = async (reason: string) => {
          noteSuppressed({ kind, user: user?.name, job: job?.name, reason })
          await recordDecision(service, dryRun, { ...base, sent: false, reason })
          return false
        }

        if (!user?.push_token) return refuse("no_push_token")
        if (!jobGate.allowed) return refuse(jobGate.reason)
        if (logUnavailable) return refuse("dedupe_unavailable")
        if (alreadySent.has(`${kind}:${dedupeKey}`)) {
          result.duplicate_skipped++
          return refuse("already_sent")
        }
        if (!gate.allowed) return refuse(gate.reason)

        if (dryRun) return true

        const { error: claimErr } = await service
          .from("notification_log")
          .insert({
            company_id: company.id,
            user_id: signin.user_id,
            job_id: signin.job_id,
            signin_id: signin.id,
            kind,
            dedupe_key: dedupeKey,
            sent: true,
            reason: context.reason || "rule_matched",
            title,
            body,
            context,
          })
        if (claimErr) {
          console.warn("[cron] push not sent, dedupe claim failed", { kind, dedupeKey, error: claimErr.message })
          result.duplicate_skipped++
          return false
        }

        await sendPushNotification([user.push_token], title, body, {
          type: kind,
          jobId: signin.job_id,
        })
        result.reminders_sent++
        alreadySent.add(`${kind}:${dedupeKey}`)
        return true
      }

      // --- Geofence auto sign-out (rule 2) ---------------------------------
      // Only on an open shift, only on at least two fixes, only when every fix
      // in the run is outside the fence with accuracy better than 100m, and
      // only once the run spans 10 continuous minutes.
      const { data: fixes } = await service
        .from("location_logs")
        .select("logged_at, within_range, accuracy_metres")
        .eq("signin_id", signin.id)
        .order("logged_at", { ascending: false })
        .limit(50)

      const geo = evaluateGeofenceAutoSignout({
        shiftOpen: true,
        fixes: fixes || [],
        now,
      })

      if (geo.signOut && geo.outsideSince) {
        const closed = await closeShift(service, dryRun, {
          signinId: signin.id,
          signedInAt: signin.signed_in_at,
          closeAt: new Date(geo.outsideSince),
          reason: "geofence_dwell",
          flagReason:
            `Auto signed out - outside the site boundary for ${geo.dwellMinutes} continuous minutes ` +
            `across ${geo.qualifyingFixes} location fixes. Hours recorded to the first fix off site. Please review.`,
        })

        if (closed) {
          companyResult.auto_closed.push({
            user: user?.name,
            job: job?.name,
            closeAt: geo.outsideSince,
            reason: geo.reason,
            dwellMinutes: geo.dwellMinutes,
            fixes: geo.qualifyingFixes,
          })
          result.auto_closed++
          await deliver(
            "auto_signout",
            `auto_signout:${signin.id}`,
            "Signed out automatically",
            `You were signed out from ${job?.name} because your phone reported you off site for ` +
              `${geo.dwellMinutes} minutes. Contact your admin if this is wrong.`,
            { reason: geo.reason, dwell_minutes: geo.dwellMinutes, fixes: geo.qualifyingFixes },
          )
          continue
        }
      }

      // --- Time-based sequence ---------------------------------------------
      if (!signin.expected_sign_out_time) continue

      const scheduledSignOutAt = combineDateAndLocalTime(
        signin.signed_in_at,
        signin.expected_sign_out_time,
        tz,
      )
      const minutesPastSignOut = Math.floor((now.getTime() - scheduledSignOutAt.getTime()) / 60000)
      if (!Number.isFinite(minutesPastSignOut)) continue

      // 1. END OF SHIFT, at the scheduled end time.
      if (minutesPastSignOut >= 0 && minutesPastSignOut < 5) {
        const sent = await deliver(
          "end_of_shift",
          `end_of_shift:${signin.id}`,
          "Shift ended",
          `Your shift at ${job?.name} has ended (${signin.expected_sign_out_time}). Please sign out.`,
          { reason: "end_of_shift", minutes_past: minutesPastSignOut },
        )
        if (sent) {
          companyResult.signout_reminders.push({
            user: user?.name,
            job: job?.name,
            minutesPast: minutesPastSignOut,
            sent: !dryRun,
            reason: "end_of_shift",
          })
        }
      }

      // 2. SIGN-OUT REMINDER, 15 min after the end, if still not signed out.
      if (minutesPastSignOut >= 15 && minutesPastSignOut < 20) {
        const sent = await deliver(
          "signout_reminder",
          `signout_reminder:${signin.id}`,
          "Time to sign out",
          `You still haven't signed out from ${job?.name}. You'll be signed out automatically in 15 minutes.`,
          { reason: "signout_reminder", minutes_past: minutesPastSignOut },
        )
        if (sent) {
          companyResult.signout_reminders.push({
            user: user?.name,
            job: job?.name,
            minutesPast: minutesPastSignOut,
            sent: !dryRun,
            reason: "signout_reminder",
          })
        }
      }

      // 3. AUTO SIGN-OUT, 30+ min past the end. Clock out at the SCHEDULED end
      // time, not at the detection time, so payroll reflects the shift worked.
      //
      // The push is sent only if the close succeeded. That ordering is the
      // whole fix: when the UPDATE was silently rejected, the old code had
      // already sent, and did so again on every tick for the next 36 hours.
      if (minutesPastSignOut >= 30) {
        const closed = await closeShift(service, dryRun, {
          signinId: signin.id,
          signedInAt: signin.signed_in_at,
          closeAt: scheduledSignOutAt,
          reason: "auto_no_signout",
          flagReason:
            `Auto signed out - no manual sign-out 30 min after shift end. Hours recorded to the ` +
            `scheduled end time (${signin.expected_sign_out_time}). Please review.`,
        })

        if (!closed) {
          // Still open, so nothing to tell the worker. Loudly, because this is
          // the state that used to produce a push storm.
          noteSuppressed({
            kind: "auto_signout",
            user: user?.name,
            job: job?.name,
            reason: "close_failed_not_notified",
          })
          continue
        }

        companyResult.auto_closed.push({
          user: user?.name,
          job: job?.name,
          closeAt: scheduledSignOutAt.toISOString(),
          reason: "auto_no_signout",
        })
        result.auto_closed++

        await deliver(
          "auto_signout",
          `auto_signout:${signin.id}`,
          "Signed out automatically",
          `You were automatically signed out from ${job?.name} at ${signin.expected_sign_out_time}. ` +
            `Contact your admin if this is wrong.`,
          { reason: "auto_no_signout", minutes_past: minutesPastSignOut },
        )
      }
    }

    result.per_company.push(companyResult)
    result.companies_processed++
  }

  return result
}

/**
 * Close an open shift. Returns whether it actually closed.
 *
 * The return value is the point. Both callers used to fire-and-forget this
 * UPDATE; when the evidence trigger started rejecting it, the shift stayed open
 * and the notification re-fired every five minutes. Nothing downstream may
 * assume a close happened without checking.
 */
async function closeShift(
  service: Service,
  dryRun: boolean,
  args: {
    signinId: string
    signedInAt: string
    closeAt: Date
    reason: string
    flagReason: string
  },
): Promise<boolean> {
  if (dryRun) return true

  const signedInMs = new Date(args.signedInAt).getTime()
  const hoursWorked = Math.max(0, (args.closeAt.getTime() - signedInMs) / 3600000)

  const { data, error } = await service
    .from("signins")
    .update({
      signed_out_at: args.closeAt.toISOString(),
      hours_worked: parseFloat(hoursWorked.toFixed(2)),
      auto_closed: true,
      auto_closed_reason: args.reason,
      signed_out_method: "auto",
      flagged: true,
      flag_reason: args.flagReason,
    })
    .eq("id", args.signinId)
    .is("signed_out_at", null)
    .select("id")

  if (error) {
    console.error("[cron] auto sign-out UPDATE rejected - shift left open, no push sent", {
      signinId: args.signinId,
      reason: args.reason,
      code: error.code,
      message: error.message,
    })
    return false
  }
  // Zero rows means someone else closed it between the read and the write.
  // Not an error, but not ours to announce either.
  return Array.isArray(data) && data.length > 0
}
