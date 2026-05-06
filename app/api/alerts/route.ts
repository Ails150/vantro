import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const service = await createServiceClient()
  const { data: adminUser } = await service.from("users")
    .select("id, company_id, name, role")
    .eq("auth_user_id", user.id)
    .single()

  if (!adminUser || !["admin", "foreman"].includes(adminUser.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { alertId, resolutionNote } = await request.json()
  if (!alertId || !resolutionNote?.trim()) {
    return NextResponse.json({ error: "Alert ID and resolution note required" }, { status: 400 })
  }

  // Get the alert with user info
  const { data: alert } = await service.from("alerts")
    .select("*, jobs(name), users(name, push_token, email)")
    .eq("id", alertId)
    .eq("company_id", adminUser.company_id)
    .single()

  if (!alert) return NextResponse.json({ error: "Alert not found" }, { status: 404 })

  // Mark as resolved
  await service.from("alerts").update({
    is_read: true,
    status: "resolved",
    resolved_at: new Date().toISOString(),
    resolved_by: adminUser.id,
    resolution_note: resolutionNote.trim()
  }).eq("id", alertId)

  // Write resolution to diary entry so installer sees it
  if (alert.diary_entry_id) {
    await service.from("diary_entries").update({
      reply: "Resolved: " + resolutionNote.trim(),
      replied_at: new Date().toISOString(),
      replied_by: adminUser.id,
    }).eq("id", alert.diary_entry_id)
  }

  const installer = alert.users as any
  const job = alert.jobs as any

  // Push notification to installer
  if (installer?.push_token) {
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: installer.push_token,
        sound: "default",
        title: "Alert resolved - " + (job?.name || "Job"),
        body: adminUser.name + ": " + resolutionNote.trim(),
        data: { type: "alert_resolved", alertId },
        channelId: "vantro",
      })
    }).catch(() => {})
  }

return NextResponse.json({ success: true })
}