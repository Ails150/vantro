import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { runNotificationEngine } from "@/lib/scheduling/notificationEngine"

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const service = await createServiceClient()
  try {
    const result = await runNotificationEngine(service, { dryRun: false })
    console.log("[cron] notifications run", {
      companies: result.companies_processed,
      reminders: result.reminders_sent,
      admin_alerts: result.admin_alerts,
      auto_closed: result.auto_closed,
      time_off_skipped: result.time_off_skipped,
      duplicate_skipped: result.duplicate_skipped,
    })
    return NextResponse.json({ success: true, ...result })
  } catch (err: any) {
    console.error("[cron] notifications failed", err)
    return NextResponse.json(
      { success: false, error: err?.message || "unknown" },
      { status: 500 },
    )
  }
}
