import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

// PATCH /api/admin/company
// Body: { name, address?, phone?, contact_email? }
// Admin only.

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const service = await createServiceClient()
  const { data: admin } = await service
    .from("users")
    .select("company_id, role")
    .eq("auth_user_id", user.id)
    .single()
  if (!admin || admin.role !== "admin") {
    return NextResponse.json({ error: "Forbidden — admin only" }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const update: any = {}
  if (body.name !== undefined) {
    const name = (body.name || "").trim()
    if (!name) return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 })
    if (name.length > 200) return NextResponse.json({ error: "Name too long" }, { status: 400 })
    update.name = name
  }
  if (body.address !== undefined) update.address = body.address
  if (body.phone !== undefined) update.phone = body.phone
  if (body.contact_email !== undefined) {
    if (body.contact_email && !/^\S+@\S+\.\S+$/.test(body.contact_email)) {
      return NextResponse.json({ error: "Invalid contact email" }, { status: 400 })
    }
    update.contact_email = body.contact_email
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 })
  }

  const { error } = await service.from("companies").update(update).eq("id", admin.company_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
