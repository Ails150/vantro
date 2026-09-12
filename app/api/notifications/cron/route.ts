import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { runNotificationEngine } from "@/lib/scheduling/notificationEngine"
import { authoriseCron } from "@/lib/cron-auth"

export async function GET(request: Request) {
  const cron = authoriseCron(request)
  if (!cron.ok) {
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
      // Deliberately not sent, by rule. A run where this climbs and reminders
      // stays at zero is quiet hours working, not a broken cron -- the same
      // decisions are in notification_log with the reason attached.
      suppressed: result.suppressed,
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
