import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

/**
 * GET /api/admin/email-prefs
 *   Returns list of admins/foremen on the company with their prefs.
 *   Auth: requires admin role.
 *
 * PATCH /api/admin/email-prefs
 *   Body: { userId: string, prefs: { enabled, blockers, issues } }
 *   Admin can update own prefs or any team member's prefs.
 */

async function getCallingAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const service = await createServiceClient()
  const { data: row } = await service
    .from("users")
    .select("id, company_id, role")
    .eq("auth_user_id", user.id)
    .single()
  if (!row) return null
  if (!["admin", "superadmin"].includes(row.role)) return null
  return row
}

export async function GET() {
  const admin = await getCallingAdmin()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const service = await createServiceClient()
  const { data, error } = await service
    .from("users")
    .select("id, name, email, role, email_alert_prefs")
    .eq("company_id", admin.company_id)
    .in("role", ["admin", "foreman", "superadmin"])
    .order("name")

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ users: data || [] })
}

export async function PATCH(request: Request) {
  const admin = await getCallingAdmin()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const { userId, prefs } = body
  if (!userId || !prefs) {
    return NextResponse.json({ error: "userId and prefs required" }, { status: 400 })
  }

  // Validate prefs shape - whitelist keys
  const cleanPrefs = {
    enabled: prefs.enabled !== false,
    blockers: prefs.blockers !== false,
    issues: prefs.issues !== false
  }

  const service = await createServiceClient()

  // Confirm target user is in same company before update
  const { data: target } = await service
    .from("users")
    .select("id, company_id")
    .eq("id", userId)
    .single()

  if (!target || target.company_id !== admin.company_id) {
    return NextResponse.json({ error: "User not in your company" }, { status: 403 })
  }

  const { error } = await service
    .from("users")
    .update({ email_alert_prefs: cleanPrefs })
    .eq("id", userId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, prefs: cleanPrefs })
}
