import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

// DELETE /api/audit/share/[id] — revoke a share link

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const service = await createServiceClient()
  const { data: admin } = await service
    .from("users")
    .select("id, company_id, role")
    .eq("auth_user_id", user.id)
    .single()
  if (!admin || admin.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // Verify ownership
  const { data: share } = await service
    .from("audit_shares")
    .select("id, company_id")
    .eq("id", id)
    .single()

  if (!share || share.company_id !== admin.company_id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const { error } = await service
    .from("audit_shares")
    .update({ revoked: true })
    .eq("id", id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
