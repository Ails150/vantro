import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

// PATCH /api/admin/account
// Body: { name: string }
// Updates the current user's display name + initials in the users table.

function getInitials(name: string): string {
  return name.trim().split(/\s+/).map((p) => p[0] || "").join("").toUpperCase().slice(0, 2)
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const name = (body.name || "").trim()
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 })
  if (name.length > 100) return NextResponse.json({ error: "Name too long" }, { status: 400 })

  const service = await createServiceClient()
  const { error } = await service
    .from("users")
    .update({ name, initials: getInitials(name) })
    .eq("auth_user_id", user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
