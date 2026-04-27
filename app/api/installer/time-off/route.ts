// app/api/installer/time-off/route.ts
//
// Installer time-off endpoints
//   GET  /api/installer/time-off       -> list mine (most recent first)
//   POST /api/installer/time-off       -> create a new request
//
// Sick leave honours company.sick_auto_approve setting.

import { NextResponse } from "next/server"
import { verifyInstallerToken } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"

const VALID_TYPES = [
  "annual_leave",
  "sick",
  "personal",
  "bereavement",
  "training",
  "unpaid",
  "unavailable",
] as const

export async function GET(request: Request) {
  const installer = verifyInstallerToken(request)
  if (!installer)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const service = await createServiceClient()
  const { data, error } = await service
    .from("time_off_entries")
    .select(
      "id, type, status, start_date, end_date, is_half_day, half_day_period, notes, created_at, approved_at, rejection_reason"
    )
    .eq("user_id", installer.userId)
    .order("created_at", { ascending: false })
    .limit(50)

  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ entries: data || [] })
}

export async function POST(request: Request) {
  const installer = verifyInstallerToken(request)
  if (!installer)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  const { type, start_date, end_date, is_half_day, half_day_period, notes } =
    body as {
      type?: string
      start_date?: string
      end_date?: string
      is_half_day?: boolean
      half_day_period?: "am" | "pm"
      notes?: string
    }

  if (!type || !VALID_TYPES.includes(type as any))
    return NextResponse.json({ error: "Invalid type" }, { status: 400 })
  if (!start_date || !end_date)
    return NextResponse.json(
      { error: "start_date and end_date required" },
      { status: 400 }
    )
  if (end_date < start_date)
    return NextResponse.json(
      { error: "end_date must be on or after start_date" },
      { status: 400 }
    )
  if (is_half_day && start_date !== end_date)
    return NextResponse.json(
      { error: "Half-day requests must be a single day" },
      { status: 400 }
    )
  if (is_half_day && !half_day_period)
    return NextResponse.json(
      { error: "Half-day requests need half_day_period (am or pm)" },
      { status: 400 }
    )

  const service = await createServiceClient()

  // Need company_id and the company's sick_auto_approve setting
  const { data: user } = await service
    .from("users")
    .select("company_id, companies(sick_auto_approve)")
    .eq("id", installer.userId)
    .single()
  if (!user)
    return NextResponse.json({ error: "User not found" }, { status: 404 })

  const company = user.companies as any
  const autoApproveSick = !!company?.sick_auto_approve

  // Decide initial status
  const status =
    type === "sick" && autoApproveSick ? "approved" : "pending"

  const insertRow: Record<string, any> = {
    user_id: installer.userId,
    company_id: user.company_id,
    type,
    status,
    start_date,
    end_date,
    is_half_day: !!is_half_day,
    half_day_period: is_half_day ? half_day_period : null,
    notes: notes || null,
    requested_by: installer.userId,
  }

  if (status === "approved") {
    insertRow.approved_at = new Date().toISOString()
    // approved_by left null when auto-approved (system)
  }

  const { data: inserted, error } = await service
    .from("time_off_entries")
    .insert(insertRow)
    .select(
      "id, type, status, start_date, end_date, is_half_day, half_day_period, notes, created_at"
    )
    .single()

  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ entry: inserted, auto_approved: status === "approved" })
}
