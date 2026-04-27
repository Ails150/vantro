// app/api/admin/team/schedule/route.ts
//
// Per-installer schedule override.
// Reads/writes user_shifts rows (one per enabled day of the week).
// Posting an empty/cleared schedule = remove all overrides (inherit company default).

import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

type DayPattern = {
  enabled: boolean
  start?: string  // "HH:MM"
  end?: string    // "HH:MM"
  shift_type?: "regular" | "on_call" | "overnight"
}

type WeeklyPattern = {
  sun?: DayPattern
  mon?: DayPattern
  tue?: DayPattern
  wed?: DayPattern
  thu?: DayPattern
  fri?: DayPattern
  sat?: DayPattern
}

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const
type DayKey = (typeof DAY_KEYS)[number]

// GET — read existing user_shifts for an installer, in weekly-pattern shape
export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const url = new URL(request.url)
  const userId = url.searchParams.get("userId")
  if (!userId)
    return NextResponse.json({ error: "userId required" }, { status: 400 })

  const service = await createServiceClient()
  const { data: admin } = await service
    .from("users")
    .select("company_id, role")
    .eq("auth_user_id", user.id)
    .single()
  if (!admin || !["admin", "foreman"].includes(admin.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  // Verify the target user belongs to the same company
  const { data: target } = await service
    .from("users")
    .select("id, company_id")
    .eq("id", userId)
    .single()
  if (!target || target.company_id !== admin.company_id)
    return NextResponse.json({ error: "Not found" }, { status: 404 })

  const today = new Date().toISOString().slice(0, 10)
  const { data: shifts } = await service
    .from("user_shifts")
    .select("day_of_week, start_time, end_time, shift_type, effective_from, effective_until")
    .eq("user_id", userId)
    .lte("effective_from", today)
    .or(`effective_until.is.null,effective_until.gte.${today}`)

  // Reshape to weekly pattern
  const weekly: WeeklyPattern = {}
  for (const k of DAY_KEYS) weekly[k] = { enabled: false }
  for (const s of shifts || []) {
    const key = DAY_KEYS[s.day_of_week]
    weekly[key] = {
      enabled: true,
      start: s.start_time.slice(0, 5),
      end: s.end_time.slice(0, 5),
      shift_type: s.shift_type,
    }
  }

  return NextResponse.json({ userId, weekly_pattern: weekly })
}

// POST — replace this user's shifts with the supplied weekly pattern
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { userId, weekly_pattern } = (await request.json()) as {
    userId?: string
    weekly_pattern?: WeeklyPattern
  }

  if (!userId)
    return NextResponse.json({ error: "userId required" }, { status: 400 })
  if (!weekly_pattern || typeof weekly_pattern !== "object")
    return NextResponse.json(
      { error: "weekly_pattern object required" },
      { status: 400 }
    )

  const service = await createServiceClient()

  const { data: admin } = await service
    .from("users")
    .select("company_id, role")
    .eq("auth_user_id", user.id)
    .single()
  if (!admin || !["admin", "foreman"].includes(admin.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  // Verify target user belongs to same company
  const { data: target } = await service
    .from("users")
    .select("id, company_id")
    .eq("id", userId)
    .single()
  if (!target || target.company_id !== admin.company_id)
    return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Build new rows from the weekly pattern
  const newRows: any[] = []
  for (let dow = 0; dow < 7; dow++) {
    const key: DayKey = DAY_KEYS[dow]
    const day = weekly_pattern[key]
    if (!day?.enabled) continue
    if (!day.start || !day.end) {
      return NextResponse.json(
        { error: `${key}: enabled days must have start and end times` },
        { status: 400 }
      )
    }
    newRows.push({
      user_id: userId,
      company_id: admin.company_id,
      shift_type: day.shift_type || "regular",
      day_of_week: dow,
      start_time: day.start,
      end_time: day.end,
      effective_from: new Date().toISOString().slice(0, 10),
      // effective_until null = ongoing
    })
  }

  // Replace strategy: delete existing, insert new. Atomic from caller's
  // perspective; if insert fails, the user is left with no override and
  // falls back to company default — safe failure mode.
  const { error: delErr } = await service
    .from("user_shifts")
    .delete()
    .eq("user_id", userId)
  if (delErr)
    return NextResponse.json({ error: delErr.message }, { status: 400 })

  if (newRows.length === 0) {
    // Cleared all overrides — user now inherits company default
    return NextResponse.json({ success: true, shifts_created: 0 })
  }

  const { error: insErr } = await service.from("user_shifts").insert(newRows)
  if (insErr)
    return NextResponse.json({ error: insErr.message }, { status: 400 })

  return NextResponse.json({ success: true, shifts_created: newRows.length })
}
