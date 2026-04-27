// app/api/admin/settings/route.ts
//
// Company-level settings.
// Schedule lives in default_schedule jsonb (managed via Scheduler page).
// Operational settings: geofence, grace period, background GPS, sick auto-approve.
// Location settings: country_code, timezone.

import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

const FIELDS = [
  "id",
  "name",
  "country_code",
  "timezone",
  "default_schedule",
  "grace_period_minutes",
  "geofence_radius_metres",
  "background_gps_enabled",
  "sick_auto_approve",
] as const

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const service = await createServiceClient()
  const { data: u } = await service
    .from("users")
    .select("company_id, role")
    .eq("auth_user_id", user.id)
    .single()
  if (!u || u.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { data: company } = await service
    .from("companies")
    .select(FIELDS.join(", "))
    .eq("id", u.company_id)
    .single()

  return NextResponse.json({ company: company || {} })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const service = await createServiceClient()
  const { data: u } = await service
    .from("users")
    .select("company_id, role")
    .eq("auth_user_id", user.id)
    .single()
  if (!u || u.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const body = await request.json()
  const updates: Record<string, any> = {}

  if (body.default_schedule !== undefined) {
    if (
      typeof body.default_schedule !== "object" ||
      body.default_schedule === null ||
      Array.isArray(body.default_schedule)
    ) {
      return NextResponse.json(
        { error: "default_schedule must be an object" },
        { status: 400 }
      )
    }
    updates.default_schedule = body.default_schedule
  }
  if (body.grace_period_minutes !== undefined)
    updates.grace_period_minutes = body.grace_period_minutes
  if (body.geofence_radius_metres !== undefined)
    updates.geofence_radius_metres = body.geofence_radius_metres
  if (body.background_gps_enabled !== undefined)
    updates.background_gps_enabled = body.background_gps_enabled
  if (body.sick_auto_approve !== undefined)
    updates.sick_auto_approve = body.sick_auto_approve

  if (body.country_code !== undefined) {
    const code = String(body.country_code).trim().toUpperCase()
    if (code && !/^[A-Z]{2}$/.test(code)) {
      return NextResponse.json(
        { error: "country_code must be a 2-letter ISO code" },
        { status: 400 }
      )
    }
    updates.country_code = code || null
  }
  if (body.timezone !== undefined) {
    const tz = String(body.timezone).trim()
    if (tz && tz.length > 64) {
      return NextResponse.json({ error: "Invalid timezone" }, { status: 400 })
    }
    updates.timezone = tz || null
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 })
  }

  const { error } = await service
    .from("companies")
    .update(updates)
    .eq("id", u.company_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
