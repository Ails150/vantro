import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

const DAYS = [
  { key: "mon", dow: 1 },
  { key: "tue", dow: 2 },
  { key: "wed", dow: 3 },
  { key: "thu", dow: 4 },
  { key: "fri", dow: 5 },
  { key: "sat", dow: 6 },
  { key: "sun", dow: 0 },
]

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const service = await createServiceClient()
  const { data: u } = await service
    .from("users")
    .select("company_id, role")
    .eq("auth_user_id", user.id)
    .single()

  if (!u || !["admin", "superadmin"].includes(u.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  if (!body?.pattern) return NextResponse.json({ error: "Pattern required" }, { status: 400 })

  // Get all installers + foremen in this company
  const { data: teamMembers } = await service
    .from("users")
    .select("id")
    .eq("company_id", u.company_id)
    .in("role", ["installer", "foreman"])
    .eq("is_active", true)

  if (!teamMembers?.length) {
    return NextResponse.json({ error: "No team members to schedule" }, { status: 400 })
  }

  const today = new Date().toISOString().slice(0, 10)

  // Build all the shift rows
  const rows: any[] = []
  for (const member of teamMembers) {
    for (const d of DAYS) {
      const dayPattern = body.pattern[d.key]
      if (dayPattern?.enabled && dayPattern.start && dayPattern.end) {
        rows.push({
          user_id: member.id,
          company_id: u.company_id,
          day_of_week: d.dow,
          start_time: dayPattern.start,
          end_time: dayPattern.end,
          shift_type: "default",
          effective_from: today,
        })
      }
    }
  }

  // Wipe existing shifts for these users + insert new
  const userIds = teamMembers.map((m: any) => m.id)
  await service.from("user_shifts").delete().in("user_id", userIds)

  if (rows.length > 0) {
    const { error } = await service.from("user_shifts").insert(rows)
    if (error) {
      return NextResponse.json({ error: "Could not save shifts", detail: error.message }, { status: 400 })
    }
  }

  return NextResponse.json({ success: true, members_updated: teamMembers.length, shifts_created: rows.length })
}