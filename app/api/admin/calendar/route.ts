// app/api/admin/calendar/route.ts
//
// Returns all the data needed to render the visual week-grid calendar.
//   GET /api/admin/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD
//
// Reads from the NEW job_visits + visit_assignments tables (Phase A
// migration must have run). Falls back gracefully if no visits exist.

import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const service = await createServiceClient()
  const { data: admin } = await service
    .from("users")
    .select("id, company_id, role, companies(country_code)")
    .eq("auth_user_id", user.id)
    .single()
  if (!admin || !["admin", "foreman"].includes(admin.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const url = new URL(request.url)
  const start = url.searchParams.get("start") // YYYY-MM-DD
  const end = url.searchParams.get("end")     // YYYY-MM-DD

  if (!start || !end)
    return NextResponse.json(
      { error: "start and end query params required" },
      { status: 400 }
    )

  const company = admin.companies as any
  const countryCode = company?.country_code || "GB"

  // 1. All active installers + foreman in this company
  const { data: installers } = await service
    .from("users")
    .select("id, name, initials")
    .eq("company_id", admin.company_id)
    .in("role", ["installer", "foreman"])
    .or("is_active.is.null,is_active.eq.true")
    .order("name", { ascending: true })

  // 2. All visits in the date window (with the job they belong to)
  const { data: visits } = await service
    .from("job_visits")
    .select(
      "id, job_id, start_at, end_at, status, jobs(name, address, lat, lng)"
    )
    .eq("company_id", admin.company_id)
    .or(`start_at.lte.${end}T23:59:59,end_at.is.null`)
    // Open-ended visits (end_at null) span the whole window
    // Date-bound visits must overlap the window

  // 3. Visit assignments (which installers are on each visit)
  const visitIds = (visits || []).map((v) => v.id)
  let assignments: any[] = []
  if (visitIds.length > 0) {
    const { data: vaData } = await service
      .from("visit_assignments")
      .select("id, visit_id, user_id, role")
      .in("visit_id", visitIds)
    assignments = vaData || []
  }

  // 4. Approved time off in the window
  const { data: timeOff } = await service
    .from("time_off_entries")
    .select("id, user_id, type, status, start_date, end_date, is_half_day")
    .eq("company_id", admin.company_id)
    .eq("status", "approved")
    .lte("start_date", end)
    .gte("end_date", start)

  // 5. Public holidays in the window for this country
  const { data: holidays } = await service
    .from("public_holidays")
    .select("holiday_date, name")
    .eq("country_code", countryCode)
    .gte("holiday_date", start)
    .lte("holiday_date", end)
    .order("holiday_date", { ascending: true })

  return NextResponse.json({
    window: { start, end },
    country_code: countryCode,
    installers: installers || [],
    visits: visits || [],
    assignments,
    time_off: timeOff || [],
    public_holidays: (holidays || []).map((h) => ({
      date: h.holiday_date,
      name: h.name,
    })),
  })
}
