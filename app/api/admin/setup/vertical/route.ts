import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"
import { isVertical } from "@/lib/vertical"

// POST /api/admin/setup/vertical
// Body: { vertical: Vertical }
// Writes companies.vertical and nothing else. Admin only.
//
// Step one of the setup wizard calls this the moment an option is picked,
// before the admin continues, because every later step branches on the answer.
// It is not a plan or a billing choice and must not be presented as one.

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const service = await createServiceClient()
  const { data: admin } = await service
    .from("users")
    .select("company_id, role")
    .eq("auth_user_id", user.id)
    .single()

  if (!admin?.company_id || !["admin", "superadmin"].includes(admin.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  // Validate against the same list the check constraint holds, so a bad value
  // fails here with a readable message rather than as a constraint violation.
  if (!isVertical(body.vertical)) {
    return NextResponse.json({ error: "Unknown vertical" }, { status: 400 })
  }

  const { error } = await service
    .from("companies")
    .update({ vertical: body.vertical })
    .eq("id", admin.company_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, vertical: body.vertical })
}
