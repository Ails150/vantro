import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const service = await createServiceClient()
  const { data: adminUser } = await service.from("users").select("id, name, company_id, role").eq("auth_user_id", user.id).single()
  if (!adminUser) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const body = await request.json().catch(() => ({}))
  const { resolution, status } = body || {}

  const { data: alert } = await service
    .from("alerts")
    .select("*, jobs(name)")
    .eq("id", id)
    .eq("company_id", adminUser.company_id)
    .single()
  if (!alert) return NextResponse.json({ error: "Alert not found" }, { status: 404 })

  const updateData: any = { is_read: true }
  if (resolution !== undefined) updateData.resolution = resolution
  if (status) updateData.status = status
  const { error: updErr } = await service.from("alerts").update(updateData).eq("id", id)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  if (resolution && alert.diary_entry_id) {
    const replyText = "Resolved: " + resolution
    await service.from("diary_entries").update({
      reply: replyText,
      replied_at: new Date().toISOString(),
      replied_by: adminUser.id,
    }).eq("id", alert.diary_entry_id)

    const { data: installer } = await service
      .from("users")
      .select("push_token, name")
      .eq("id", alert.user_id)
      .single()

    if (installer?.push_token) {
      const jobName = (alert.jobs as any)?.name || "Job"
      await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: installer.push_token,
          sound: "default",
          title: "Alert resolved by " + adminUser.name,
          body: jobName + ": " + resolution,
          data: { type: "alert_resolved", alertId: id, entryId: alert.diary_entry_id },
          channelId: "vantro",
        })
      }).catch(() => {})
    }
  }

  return NextResponse.json({ success: true })
}
