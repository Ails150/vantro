import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { runNotificationEngine } from "@/lib/scheduling/notificationEngine"
import { authoriseCron } from "@/lib/cron-auth"

// Dry-run preview of what the notification cron would do RIGHT NOW.
// Doesn't send pushes, doesn't write to DB.
//
// Auth: requires the same CRON_SECRET so only you can hit it. Call as:
//   GET /api/notifications/cron-debug
//   Authorization: Bearer <CRON_SECRET>
//
// In a browser you can also pass it as a query string for quick testing:
//   /api/notifications/cron-debug?key=<CRON_SECRET>

export async function GET(request: Request) {
  // Also accepts ?key= so it can be opened in a browser. Both paths go
  // through the same check, which refuses outright when CRON_SECRET is unset
  // rather than matching the string "undefined".
  const url = new URL(request.url)
  const queryKey = url.searchParams.get("key")
  const viaHeader = authoriseCron(request).ok
  const viaQuery = !!process.env.CRON_SECRET && queryKey === process.env.CRON_SECRET
  if (!viaHeader && !viaQuery) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const service = await createServiceClient()
  try {
    const result = await runNotificationEngine(service, { dryRun: true })
    return NextResponse.json({ success: true, ...result }, {
      headers: { "Cache-Control": "no-store" },
    })
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || "unknown", stack: err?.stack },
      { status: 500 },
    )
  }
}
