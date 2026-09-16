import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { authoriseCron } from "@/lib/cron-auth"

export async function GET(request: Request) {
  const cron = authoriseCron(request)
  if (!cron.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const service = await createServiceClient()

  // Get all companies with their retention settings
  const { data: companies } = await service.from("companies").select("id, data_retention_days")
  if (!companies) return NextResponse.json({ success: true, deleted: 0 })

  let totalDeleted = 0

  for (const company of companies) {
    const retentionDays = company.data_retention_days || 90
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays)

    // Delete old breadcrumbs
    const { count } = await service.from("location_logs")
      .delete({ count: "exact" })
      .eq("company_id", company.id)
      .lt("logged_at", cutoffDate.toISOString())

    totalDeleted += count || 0
  }

  // Prune the rate limiter's own table.
  //
  // Here rather than on the hot path: deleting on every check would make a
  // write out of every rate-limit decision, on the busiest table in the system,
  // to reclaim rows that cost almost nothing to leave for a day. 24 hours is
  // comfortably longer than the longest window any caller uses, so nothing
  // still in scope is removed.
  //
  // It is not fatal. The rest of the cleanup has already run by this point, and
  // a failure here means the table is slightly larger tomorrow.
  let rateLimitRowsPruned = 0
  const { data: pruned, error: pruneErr } = await service.rpc("prune_rate_limit_hits")
  if (pruneErr) console.error("[cleanup] rate limit prune failed:", pruneErr.message)
  else rateLimitRowsPruned = Number(pruned) || 0

  // Log the cleanup
  await service.from("audit_log").insert({
    company_id: companies[0]?.id || '00000000-0000-0000-0000-000000000000',
    action: "data_retention_cleanup",
    entity_type: "system",
    details: {
      total_deleted: totalDeleted,
      rate_limit_rows_pruned: rateLimitRowsPruned,
      run_at: new Date().toISOString(),
    },
  })

  return NextResponse.json({ success: true, deleted: totalDeleted, rateLimitRowsPruned })
}