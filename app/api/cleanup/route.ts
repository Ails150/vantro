import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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

  // Log the cleanup
  await service.from("audit_log").insert({
    company_id: companies[0]?.id || '00000000-0000-0000-0000-000000000000',
    action: "data_retention_cleanup",
    entity_type: "system",
    details: { total_deleted: totalDeleted, run_at: new Date().toISOString() },
  })

  return NextResponse.json({ success: true, deleted: totalDeleted })
}