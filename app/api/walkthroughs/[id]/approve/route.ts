import { NextRequest, NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const service = await createServiceClient()
  const { data: u } = await service
    .from("users")
    .select("id, company_id, role")
    .eq("auth_user_id", user.id)
    .single()
  if (!u || !["admin","foreman","superadmin"].includes(u.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { error } = await service
    .from("walkthroughs")
    .update({
      approval_status: "approved",
      approved_by: u.id,
      approved_at: new Date().toISOString(),
      rejected_reason: null,
    })
    .eq("id", id)
    .eq("company_id", u.company_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
