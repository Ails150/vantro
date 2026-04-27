// app/api/admin/time-off/route.ts
//
// Admin time-off endpoints
//   GET  /api/admin/time-off?status=pending|approved|rejected|all&from=YYYY-MM-DD&to=YYYY-MM-DD
//        -> list across the whole company, with user info joined
//   POST /api/admin/time-off
//        -> create on behalf of an installer (defaults to approved)

import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

const VALID_TYPES = [
  "annual_leave",
  "sick",
  "personal",
  "bereavement",
  "training",
  "unpaid",
  "unavailable",
] as const

async function requireAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Unauthorized", status: 401 as const }

  const service = await createServiceClient()
  const { data: u } = await service
    .from("users")
    .select("id, company_id, role")
    .eq("auth_user_id", user.id)
    .single()
  if (!u || !["admin", "foreman"].includes(u.role))
    return { error: "Forbidden", status: 403 as const }

  return { service, admin: u }
}

export async function GET(request: Request) {
  const ctx = await requireAdmin()
  if ("error" in ctx)
    return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  const url = new URL(request.url)
  const status = url.searchParams.get("status")
  const from = url.searchParams.get("from")
  const to = url.searchParams.get("to")

  let query = ctx.service
    .from("time_off_entries")
    .select(
      "id, user_id, type, status, start_date, end_date, is_half_day, half_day_period, notes, created_at, approved_at, rejection_reason, users!time_off_entries_user_id_fkey(name, initials)"
    )
    .eq("company_id", ctx.admin.company_id)
    .order("created_at", { ascending: false })

  if (status && status !== "all") query = query.eq("status", status)
  if (from) query = query.gte("end_date", from)
  if (to) query = query.lte("start_date", to)

  const { data, error } = await query.limit(200)
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ entries: data || [] })
}

export async function POST(request: Request) {
  const ctx = await requireAdmin()
  if ("error" in ctx)
    return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  const body = await request.json()
  const {
    user_id,
    type,
    start_date,
    end_date,
    is_half_day,
    half_day_period,
    notes,
    status,
  } = body as {
    user_id?: string
    type?: string
    start_date?: string
    end_date?: string
    is_half_day?: boolean
    half_day_period?: "am" | "pm"
    notes?: string
    status?: "pending" | "approved" | "rejected"
  }

  if (!user_id)
    return NextResponse.json({ error: "user_id required" }, { status: 400 })
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

  const { data: target } = await ctx.service
    .from("users")
    .select("id, company_id")
    .eq("id", user_id)
    .single()
  if (!target || target.company_id !== ctx.admin.company_id)
    return NextResponse.json({ error: "Not found" }, { status: 404 })

  const finalStatus = status || "approved"

  const insertRow: Record<string, any> = {
    user_id,
    company_id: ctx.admin.company_id,
    type,
    status: finalStatus,
    start_date,
    end_date,
    is_half_day: !!is_half_day,
    half_day_period: is_half_day ? half_day_period : null,
    notes: notes || null,
    requested_by: ctx.admin.id,
  }
  if (finalStatus === "approved") {
    insertRow.approved_by = ctx.admin.id
    insertRow.approved_at = new Date().toISOString()
  }

  const { data: inserted, error } = await ctx.service
    .from("time_off_entries")
    .insert(insertRow)
    .select("*")
    .single()

  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ entry: inserted })
}
