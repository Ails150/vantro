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

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const service = await createServiceClient()
  const now = new Date()
  const utcHour = now.getUTCHours()
  const utcMinute = now.getUTCMinutes()
  const ukOffset = isBST(now) ? 1 : 0
  const ukHour = (utcHour + ukOffset) % 24
  const currentMinutes = ukHour * 60 + utcMinute

  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  const results: any = { ukHour, currentMinutes, reminders_sent: 0, admin_alerts: 0, auto_closed: 0 }

  // === SIGN-IN REMINDERS: check upcoming shifts ===
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

  // === SIGN-OUT PROCESSING ===
  const { data: activeSignins } = await service
    .from("signins")
    .select("id, user_id, job_id, company_id, signed_in_at, expected_sign_out_time, reminder_sent_at, admin_reminder_sent_at, jobs(name, lat, lng, company_id), users(name, push_token)")
    .is("signed_out_at", null)

  if (activeSignins && activeSignins.length > 0) {
    for (const signin of activeSignins) {
      const user = signin.users as any
      const job = signin.jobs as any
      if (!signin.expected_sign_out_time) continue

      const [soh, som] = signin.expected_sign_out_time.split(":").map(Number)
      const signOutMinutes = soh * 60 + som
      const minutesPastSignOut = currentMinutes - signOutMinutes

      // INSTALLER REMINDER: fire once within 0-15 min past sign-out time
      if (minutesPastSignOut >= 0 && minutesPastSignOut < 20 && !signin.reminder_sent_at && user?.push_token) {
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
        // Find last breadcrumb where they were on site (within 150m of job)
        let closeAt = new Date(`${new Date().toISOString().split("T")[0]}T${signin.expected_sign_out_time}Z`)
        // Convert to UTC from UK time
        closeAt = new Date(closeAt.getTime() - ukOffset * 3600000)
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