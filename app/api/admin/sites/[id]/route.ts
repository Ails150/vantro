import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

// /api/admin/sites/[id]
//   PATCH  → update site fields
//   DELETE → soft-delete (set is_active = false)

async function getAdmin(authUserId: string) {
  const service = await createServiceClient()
  const { data } = await service
    .from("users")
    .select("id, company_id, role")
    .eq("auth_user_id", authUserId)
    .single()
  return { service, admin: data }
}

async function ensureSiteOwnership(service: any, siteId: string, companyId: string) {
  const { data } = await service
    .from("sites")
    .select("id, company_id")
    .eq("id", siteId)
    .single()
  if (!data || data.company_id !== companyId) return false
  return true
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { service, admin } = await getAdmin(user.id)
  if (!admin || admin.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const owns = await ensureSiteOwnership(service, id, admin.company_id)
  if (!owns) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const body = await request.json().catch(() => ({}))
  const update: any = {}
  if (body.name !== undefined) update.name = (body.name || "").trim()
  if (body.address !== undefined) update.address = (body.address || "").trim()
  if (body.postcode !== undefined) update.postcode = (body.postcode || "").trim() || null
  if (body.client_name !== undefined) update.client_name = (body.client_name || "").trim() || null
  if (body.notes !== undefined) update.notes = (body.notes || "").trim() || null
  update.updated_at = new Date().toISOString()

  if (update.name === "") return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 })
  if (update.address === "") return NextResponse.json({ error: "Address cannot be empty" }, { status: 400 })

  const { data, error } = await service.from("sites").update(update).eq("id", id).select("*").single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ site: data })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { service, admin } = await getAdmin(user.id)
  if (!admin || admin.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const owns = await ensureSiteOwnership(service, id, admin.company_id)
  if (!owns) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Soft-delete to preserve history; jobs that reference this site keep working (site_id stays)
  const { error } = await service
    .from("sites")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
