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

  // ── Sign-in reminder: runs every 30 mins, checks jobs starting within next 30 mins ──
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  // Get all active jobs with a start_time
  const { data: activeJobs } = await service
    .from("jobs")
    .select("id, name, start_time, company_id")
    .eq("status", "active")
    .not("start_time", "is", null)

  if (activeJobs) {
    for (const job of activeJobs) {
      // Parse start_time "HH:MM:SS" into minutes
      const [h, m] = job.start_time.split(":").map(Number)
      const jobMinutes = h * 60 + m

      // Send reminder if job starts in next 30 mins and hasn't started yet
      if (jobMinutes > currentMinutes && jobMinutes <= currentMinutes + 30) {
        const minutesUntil = jobMinutes - currentMinutes

        // Get assigned installers who haven't signed in today
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

  // ── 6pm: Sign-out reminder ──
  if (ukHour === 17) {
    const { data: activeSignins } = await service
      .from("signins")
      .select("user_id, job_id, jobs(name, company_id), users(name, push_token)")
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
          `You are still signed in to ${job?.name}. Please sign out when you leave site.`,
          { type: "signout_reminder_1", jobId: signin.job_id }
        )
      }

      if (activeSignins.length > 0) {
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
            await sendPushNotification(
              tokens,
              `${stillOnSite.length} installer${stillOnSite.length > 1 ? "s" : ""} still signed in`,
              `${stillOnSite.map((s: any) => (s.users as any)?.name).join(", ")} still on site at 6pm`,
              { type: "admin_still_on_site" }
            )
          }
        }
      }
    }
  }

  // ── 7pm: Second sign-out reminder ──
  if (ukHour === 18) {
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
          "Please sign out now",
          `You are still signed in to ${job?.name}. Your manager has been notified. Please sign out.`,
          { type: "signout_reminder_2", jobId: signin.job_id }
        )
      }
    }
  }

  return NextResponse.json({ success: true, ukHour, currentMinutes })
}