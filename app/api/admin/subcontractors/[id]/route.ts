import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

const RATE_TYPES = new Set(["hourly", "daily", "weekly", "monthly", "per_job"])

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
  if (!["admin", "foreman", "superadmin"].includes(row.role)) return null
  return row
}

interface Params {
  params: Promise<{ id: string }>
}

export async function GET(_: Request, { params }: Params) {
  const admin = await getCallingAdmin()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params

  const service = await createServiceClient()
  const { data: sub, error } = await service
    .from("subcontractors")
    .select("*")
    .eq("id", id)
    .eq("company_id", admin.company_id)
    .single()

  if (error || !sub) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const { data: assignments } = await service
    .from("subcontractor_assignments")
    .select("id, job_id, status, expected_crew_size, expected_days, assigned_at, completed_at")
    .eq("subcontractor_id", id)
    .order("assigned_at", { ascending: false })

  const { data: crewLeads } = await service
    .from("users")
    .select("id, name, email")
    .eq("subcontractor_id", id)

  return NextResponse.json({
    subcontractor: sub,
    assignments: assignments || [],
    crew_leads: crewLeads || [],
  })
}

export async function PATCH(request: Request, { params }: Params) {
  const admin = await getCallingAdmin()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params

  const body = await request.json().catch(() => ({}))
  const update: Record<string, any> = {}

  if (body.name !== undefined) {
    if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 })
    }
    update.name = body.name.trim()
  }
  if (body.rate_type !== undefined) {
    if (!RATE_TYPES.has(body.rate_type)) {
      return NextResponse.json({ error: "Invalid rate_type" }, { status: 400 })
    }
    update.rate_type = body.rate_type
  }
  if (body.rate_amount !== undefined) {
    if (body.rate_amount === null || body.rate_amount === "") {
      update.rate_amount = null
    } else {
      const num = parseFloat(body.rate_amount)
      if (isNaN(num) || num < 0) {
        return NextResponse.json({ error: "Invalid rate_amount" }, { status: 400 })
      }
      update.rate_amount = num
    }
  }
  if (body.liability_cover_amount !== undefined) {
    if (body.liability_cover_amount === null || body.liability_cover_amount === "") {
      update.liability_cover_amount = null
    } else {
      const num = parseFloat(body.liability_cover_amount)
      if (isNaN(num) || num < 0) {
        return NextResponse.json({ error: "Invalid liability_cover_amount" }, { status: 400 })
      }
      update.liability_cover_amount = num
    }
  }
  for (const k of ["contact_name", "contact_phone", "contact_email", "address", "notes", "insurance_provider", "insurance_policy_no", "insurance_expiry", "vat_number", "utr_number"]) {
    if (body[k] !== undefined) update[k] = body[k] || null
  }
  for (const k of ["active", "cis_registered", "rams_on_file", "portal_enabled"]) {
    if (body[k] !== undefined) update[k] = !!body[k]
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 })
  }

  const service = await createServiceClient()
  const { data: existing } = await service
    .from("subcontractors")
    .select("company_id")
    .eq("id", id)
    .single()

  if (!existing || existing.company_id !== admin.company_id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const { error } = await service.from("subcontractors").update(update).eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}

export async function DELETE(_: Request, { params }: Params) {
  const admin = await getCallingAdmin()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params

  const service = await createServiceClient()
  const { data: existing } = await service
    .from("subcontractors")
    .select("company_id")
    .eq("id", id)
    .single()

  if (!existing || existing.company_id !== admin.company_id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const { error } = await service
    .from("subcontractors")
    .update({ active: false })
    .eq("id", id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
