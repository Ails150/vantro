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

  // â”€â”€ Sign-in reminder: runs every 30 mins, checks jobs starting within next 30 mins â”€â”€
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

  // â”€â”€ SIGN-OUT REMINDERS: Based on job/company sign-out time â”€â”€
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
        // Past sign-out time â€” send reminders every 15 mins
        if (minutesPastSignOut % 15 < 5) { // within 5 min window of each 15-min mark (cron runs every 15 mins)
          const graceRemaining = gracePeriod - minutesPastSignOut

          if (graceRemaining > 0) {
            // Still within grace period â€” send reminder
            const timeStr = `${soh}:${som.toString().padStart(2, "0")}`
            await sendPushNotification(
              [user.push_token],
              "Sign out reminder",
              `Your sign-out time was ${timeStr}. Please return to site and sign out. If you do not sign out within ${graceRemaining} minutes, your hours will be recorded as zero.`,
              { type: "signout_reminder", jobId: signin.job_id }
            )
          } else {
            // Grace period expired â€” auto-close with zero hours
            await service.from("signins").update({
              signed_out_at: now.toISOString(),
              hours_worked: Math.max(0, parseFloat(((now.getTime() - new Date(signin.signed_in_at).getTime()) / 3600000).toFixed(2))),
              auto_closed: true,
              auto_closed_reason: "auto_closed_gps",
              flagged: true,
              flag_reason: `Did not sign out. Expected: ${soh}:${som.toString().padStart(2, "0")}. Auto-closed after ${gracePeriod} min grace. Zero hours.`,
            }).eq("id", signin.id)

            await sendPushNotification(
              [user.push_token],
              "Shift auto-closed",
              `Your shift at ${job?.name} was automatically closed. Hours recorded based on your start time. Please speak to your manager if incorrect.`,
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
                "Shift auto-closed",
                `${user?.name} did not sign out of ${job?.name}. Hours auto-recorded. Please review.`,
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
              `${pastDue.map((s: any) => (s.users as any)?.name).join(", ")} â€” still signed in past expected finish`,
              { type: "admin_past_signout" }
            )
          }
        }
      }
    }
  }

  return NextResponse.json({ success: true, ukHour, currentMinutes })
}