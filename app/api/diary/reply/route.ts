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

  if (!adminUser) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const { entryId, userId, message } = await request.json()
  if (!message?.trim()) return NextResponse.json({ error: "Message required" }, { status: 400 })

  // Save the reply to the diary entry
  const { error: updateErr } = await service.from("diary_entries")
    .update({
      reply: message.trim(),
      replied_at: new Date().toISOString(),
      replied_by: adminUser.id,
    })
    .eq("id", entryId)
    .eq("company_id", adminUser.company_id)

  if (updateErr) {
    console.error("[diary/reply] update failed", updateErr)
    return NextResponse.json({ error: "Failed to save reply", detail: updateErr.message }, { status: 500 })
  }

  // Get the installer's push token and email
  const { data: installer } = await service.from("users")
    .select("push_token, email, name")
    .eq("id", userId)
    .single()

  if (!installer) return NextResponse.json({ success: true, warning: "Reply saved but installer not found" })

  // Get the diary entry for context
  const { data: entry } = await service.from("diary_entries")
    .select("entry_text, jobs(name)")
    .eq("id", entryId)
    .single()

  const jobName = (entry?.jobs as any)?.name || "Job"

  // Push notification to installer
  if (installer.push_token) {
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: installer.push_token,
        sound: "default",
        title: "Message from " + adminUser.name,
        body: message.trim(),
        data: { type: "diary_reply", entryId },
        channelId: "vantro",
      })
    }).catch(() => {})
  }

return NextResponse.json({ success: true })
}