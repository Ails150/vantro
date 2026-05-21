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

export async function GET() {
  const admin = await getCallingAdmin()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const service = await createServiceClient()
  const { data: subs, error } = await service
    .from("subcontractors")
    .select("*")
    .eq("company_id", admin.company_id)
    .order("active", { ascending: false })
    .order("name")

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const subIds = (subs || []).map((s: any) => s.id)
  let assignments: any[] = []
  if (subIds.length > 0) {
    const { data } = await service
      .from("subcontractor_assignments")
      .select("subcontractor_id, status")
      .in("subcontractor_id", subIds)
      .eq("status", "active")
    assignments = data || []
  }

  const countMap = new Map<string, number>()
  for (const a of assignments) {
    countMap.set(a.subcontractor_id, (countMap.get(a.subcontractor_id) || 0) + 1)
  }

  const hydrated = (subs || []).map((s: any) => ({
    ...s,
    active_assignment_count: countMap.get(s.id) || 0,
  }))

  return NextResponse.json({ subcontractors: hydrated })
}

export async function POST(request: Request) {
  const admin = await getCallingAdmin()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const {
    name,
    contact_name,
    contact_phone,
    contact_email,
    address,
    rate_type,
    rate_amount,
    notes,
    active,
    insurance_provider,
    insurance_policy_no,
    insurance_expiry,
    liability_cover_amount,
    vat_number,
    utr_number,
    cis_registered,
    rams_on_file,
    portal_enabled,
  } = body

  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Name required" }, { status: 400 })
  }
  if (!rate_type || !RATE_TYPES.has(rate_type)) {
    return NextResponse.json({ error: "Invalid rate_type" }, { status: 400 })
  }

  let rateAmountNum: number | null = null
  if (rate_amount !== undefined && rate_amount !== null && rate_amount !== "") {
    rateAmountNum = parseFloat(rate_amount)
    if (isNaN(rateAmountNum) || rateAmountNum < 0) {
      return NextResponse.json({ error: "Invalid rate_amount" }, { status: 400 })
    }
  }

  let liabilityNum: number | null = null
  if (liability_cover_amount !== undefined && liability_cover_amount !== null && liability_cover_amount !== "") {
    liabilityNum = parseFloat(liability_cover_amount)
    if (isNaN(liabilityNum) || liabilityNum < 0) {
      return NextResponse.json({ error: "Invalid liability_cover_amount" }, { status: 400 })
    }
  }

  const service = await createServiceClient()
  const { data, error } = await service
    .from("subcontractors")
    .insert({
      company_id: admin.company_id,
      name: name.trim(),
      contact_name: contact_name || null,
      contact_phone: contact_phone || null,
      contact_email: contact_email || null,
      address: address || null,
      rate_type,
      rate_amount: rateAmountNum,
      notes: notes || null,
      active: active !== false,
      insurance_provider: insurance_provider || null,
      insurance_policy_no: insurance_policy_no || null,
      insurance_expiry: insurance_expiry || null,
      liability_cover_amount: liabilityNum,
      vat_number: vat_number || null,
      utr_number: utr_number || null,
      cis_registered: !!cis_registered,
      rams_on_file: !!rams_on_file,
      portal_enabled: !!portal_enabled,
      created_by: admin.id,
    })
    .select()
    .single()

  if (error) {
    console.error("[subcontractors POST] Insert failed:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, subcontractor: { ...data, active_assignment_count: 0 } })
}
