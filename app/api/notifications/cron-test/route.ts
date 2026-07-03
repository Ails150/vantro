// app/api/notifications/cron-test/route.ts
//
// LOCAL-ONLY test harness for the notification engine. TEMPORARY - delete after
// testing the new shift-notification sequence.
//
// Safety:
//   - Hard 404 in production (NODE_ENV === "production"), so even if accidentally
//     deployed it can never run against the live cron path.
//   - REQUIRES ?companyId=<uuid>. Refuses to run without it, so it can never run
//     globally across all companies. Pass ONLY your throwaway test company id.
//
// Usage (local dev only):
//   GET http://localhost:3000/api/notifications/cron-test?companyId=<TEST_COMPANY_ID>
//
// This runs the REAL runNotificationEngine (dryRun: false) scoped to that one
// company, so it writes exactly like the production cron would - but only ever
// to rows belonging to the company id you pass.

import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { runNotificationEngine } from "@/lib/scheduling/notificationEngine"

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 404 })
  }

  const companyId = new URL(request.url).searchParams.get("companyId")
  if (!companyId) {
    return NextResponse.json(
      { error: "companyId query param is required - this route refuses to run globally" },
      { status: 400 },
    )
  }

  const service = await createServiceClient()
  try {
    const result = await runNotificationEngine(service, { dryRun: false, onlyCompanyId: companyId })
    return NextResponse.json({ success: true, scopedTo: companyId, ...result }, {
      headers: { "Cache-Control": "no-store" },
    })
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || "unknown", stack: err?.stack },
      { status: 500 },
    )
  }
}
