Set-Location C:\vantro

# Update vercel.json to add 7pm second reminder
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
    },
    {
      "path": "/api/notifications/cron",
      "schedule": "0 18 * * 1-6"
    }
  ]
}
'@

[System.IO.File]::WriteAllText("C:\vantro\vercel.json", $vercelJson, [System.Text.UTF8Encoding]::new($false))

# Update cron route - 6pm first reminder, 7pm second reminder, NO auto sign-out
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
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const service = await createServiceClient()
  const now = new Date()
  const hour = now.getUTCHours()
  const ukHour = (hour + 1) % 24 // BST offset

  // ── 8:30am: Sign-in reminder ────────────────────────
  if (ukHour === 8) {
    const today = new Date(); today.setHours(0,0,0,0)

    const { data: assignments } = await service
      .from("job_assignments")
      .select("user_id, job_id, jobs(name, status), users(name, push_token)")

    if (assignments) {
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

  // ── 6pm: First sign-out reminder ────────────────────
  // REMINDER ONLY - never auto sign out
  // Accurate payroll requires installer to sign out themselves
  if (ukHour === 17) {
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
          `You are still signed in to ${job?.name}. Please sign out when you leave site.`,
          { type: "signout_reminder_1", jobId: signin.job_id }
        )
      }
    }

    // Also notify admin of anyone still on site at 6pm
    if (activeSignins && activeSignins.length > 0) {
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

  // ── 7pm: Second sign-out reminder (urgent) ──────────
  // Still REMINDER ONLY - payroll accuracy depends on installer signing out
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
          "Please sign out now",
          `You are still signed in to ${job?.name}. Your manager has been notified. Please sign out.`,
          { type: "signout_reminder_2", jobId: signin.job_id }
        )
      }
    }
  }

  return NextResponse.json({ success: true, hour: ukHour })
}
'@

[System.IO.File]::WriteAllText("C:\vantro\app\api\notifications\cron\route.ts", $cronRoute, [System.Text.UTF8Encoding]::new($false))
Write-Host "Cron route updated - reminders only, no auto sign-out" -ForegroundColor Green

git add app\api\notifications\cron\route.ts vercel.json
git commit -m "Notifications: reminders only, no auto sign-out - payroll accuracy"
git push origin master
Write-Host "Pushed" -ForegroundColor Cyan
