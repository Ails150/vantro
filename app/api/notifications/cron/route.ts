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

  // â”€â”€ Sign-in reminder at 8:30am â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ Sign-out reminder at 6pm â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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