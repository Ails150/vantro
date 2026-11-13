import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"
import { isDashboardRole } from "@/lib/company-context"

// A manager replying to an installer's diary entry.
//
// The recipient is whoever WROTE the entry, read from the company-scoped row
// this request just updated -- never the body's userId. Taking it from the body
// let any signed-in user push a message, titled with their own name, to any
// installer in any company.

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 })

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const service = await createServiceClient()
  const { data: adminUser } = await service.from("users")
    .select("id, company_id, name, role")
    .eq("auth_user_id", user.id)
    .single()

  if (!adminUser) return notFound()
  if (!isDashboardRole(adminUser.role) || !adminUser.company_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { entryId, message } = await request.json().catch(() => ({}))
  if (!message?.trim()) return NextResponse.json({ error: "Message required" }, { status: 400 })
  if (typeof entryId !== "string" || !entryId) return notFound()

  // Save the reply to the diary entry; the row that matched names the recipient.
  const { data: updated, error: updateErr } = await service.from("diary_entries")
    .update({
      reply: message.trim(),
      replied_at: new Date().toISOString(),
      replied_by: adminUser.id,
    })
    .eq("id", entryId)
    .eq("company_id", adminUser.company_id)
    .select("user_id, entry_text, jobs(name)")

  if (updateErr) {
    console.error("[diary/reply] update failed", updateErr)
    return NextResponse.json({ error: "Failed to save reply" }, { status: 500 })
  }
  const entry = (updated || [])[0] as any
  if (!entry) return notFound()

  // Get the installer's push token -- same company, by construction and by filter.
  const { data: installer } = entry.user_id
    ? await service.from("users")
        .select("push_token, email, name")
        .eq("id", entry.user_id)
        .eq("company_id", adminUser.company_id)
        .maybeSingle()
    : { data: null }

  if (!installer) return NextResponse.json({ success: true, warning: "Reply saved but installer not found" })

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