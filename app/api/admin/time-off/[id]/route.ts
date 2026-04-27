// app/api/admin/time-off/[id]/route.ts
//
// Approve or reject a time-off entry.
//   PATCH /api/admin/time-off/<id>  body: { status: 'approved' | 'rejected', rejection_reason?: string }
//
// Sends a push notification to the installer when their request is decided.

import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

const TYPE_LABELS: Record<string, string> = {
  annual_leave: "annual leave",
  sick: "sick leave",
  personal: "personal time",
  bereavement: "bereavement leave",
  training: "training",
  unpaid: "unpaid leave",
  unavailable: "unavailable time",
}

async function sendPushNotification(
  tokens: string[],
  title: string,
  body: string,
  data?: any
) {
  if (!tokens || tokens.length === 0) return
  const messages = tokens.map((token) => ({
    to: token,
    sound: "default",
    title,
    body,
    data: data || {},
    channelId: "vantro",
  }))
  try {
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(messages),
    })
  } catch (err) {
    console.error("[time-off] push failed", err)
  }
}

function formatDateRange(start: string, end: string): string {
  if (start === end) return formatDate(start)
  const s = new Date(start + "T00:00:00Z")
  const e = new Date(end + "T00:00:00Z")
  if (
    s.getUTCMonth() === e.getUTCMonth() &&
    s.getUTCFullYear() === e.getUTCFullYear()
  ) {
    return `${s.getUTCDate()}\u2013${e.getUTCDate()} ${s.toLocaleDateString("en-GB", { month: "short" })}`
  }
  return `${formatDate(start)} \u2013 ${formatDate(end)}`
}

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z")
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const service = await createServiceClient()
  const { data: admin } = await service
    .from("users")
    .select("id, company_id, role, name")
    .eq("auth_user_id", user.id)
    .single()
  if (!admin || !["admin", "foreman"].includes(admin.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { status, rejection_reason } = (await request.json()) as {
    status?: "approved" | "rejected"
    rejection_reason?: string
  }
  if (status !== "approved" && status !== "rejected")
    return NextResponse.json(
      { error: "status must be 'approved' or 'rejected'" },
      { status: 400 }
    )

  // Verify entry belongs to admin's company; pull installer details for push
  const { data: entry } = await service
    .from("time_off_entries")
    .select(
      "id, company_id, status, type, start_date, end_date, user_id, users!time_off_entries_user_id_fkey(push_token, name)"
    )
    .eq("id", id)
    .single()
  if (!entry || entry.company_id !== admin.company_id)
    return NextResponse.json({ error: "Not found" }, { status: 404 })

  const updates: Record<string, any> = {
    status,
    approved_by: admin.id,
    approved_at: new Date().toISOString(),
  }
  if (status === "rejected") {
    updates.rejection_reason = rejection_reason || null
  } else {
    updates.rejection_reason = null
  }

  const { data: updated, error } = await service
    .from("time_off_entries")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single()

  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 })

  // Push notification to the installer
  const installer = entry.users as any
  if (installer?.push_token) {
    const typeLabel = TYPE_LABELS[entry.type] || "time off"
    const dateRange = formatDateRange(entry.start_date, entry.end_date)
    if (status === "approved") {
      await sendPushNotification(
        [installer.push_token],
        "Time off approved",
        `Your ${typeLabel} for ${dateRange} was approved by ${admin.name || "your admin"}.`,
        { type: "time_off_approved", entryId: entry.id }
      )
    } else {
      await sendPushNotification(
        [installer.push_token],
        "Time off declined",
        rejection_reason
          ? `Your ${typeLabel} for ${dateRange} was declined: ${rejection_reason}`
          : `Your ${typeLabel} for ${dateRange} was declined. Tap to see details.`,
        { type: "time_off_rejected", entryId: entry.id }
      )
    }
  }

  return NextResponse.json({ entry: updated })
}
