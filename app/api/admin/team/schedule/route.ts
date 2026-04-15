import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { userId, sign_in_time, sign_out_time, working_days } = await request.json()

  const { data: admin } = await supabase.from("users").select("company_id, role").eq("auth_user_id", user.id).single()
  if (!admin || !["admin","foreman"].includes(admin.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { error } = await supabase.from("users")
    .update({ sign_in_time, sign_out_time, working_days })
    .eq("id", userId)
    .eq("company_id", admin.company_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
