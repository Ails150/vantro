import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

// /api/admin/sites
//   GET  → list sites for the company
//   POST → create a single site

async function geocodeAddress(address: string, postcode?: string): Promise<{ lat: number; lng: number } | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) return null
  const fullAddress = postcode ? `${address}, ${postcode}` : address
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(fullAddress)}&key=${apiKey}`
  try {
    const res = await fetch(url)
    const data = await res.json()
    if (data.status === "OK" && data.results?.[0]?.geometry?.location) {
      return data.results[0].geometry.location
    }
  } catch {}
  return null
}

async function getAdmin(authUserId: string) {
  const service = await createServiceClient()
  const { data } = await service
    .from("users")
    .select("id, company_id, role")
    .eq("auth_user_id", authUserId)
    .single()
  return { service, admin: data }
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { service, admin } = await getAdmin(user.id)
  if (!admin || admin.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { data, error } = await service
    .from("sites")
    .select("*")
    .eq("company_id", admin.company_id)
    .eq("is_active", true)
    .order("name", { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ sites: data || [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { service, admin } = await getAdmin(user.id)
  if (!admin || admin.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const name = (body.name || "").trim()
  const address = (body.address || "").trim()
  const postcode = (body.postcode || "").trim() || undefined
  const clientName = (body.client_name || "").trim() || undefined
  const notes = (body.notes || "").trim() || undefined

  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 })
  if (!address) return NextResponse.json({ error: "Address is required" }, { status: 400 })

  // Check for duplicate name in this company
  const { data: existing } = await service
    .from("sites")
    .select("id")
    .eq("company_id", admin.company_id)
    .eq("name", name)
    .eq("is_active", true)
    .maybeSingle()
  if (existing) return NextResponse.json({ error: "A site with this name already exists" }, { status: 400 })

  const coords = await geocodeAddress(address, postcode)
  const insertData: any = {
    company_id: admin.company_id,
    name,
    address,
    postcode,
    client_name: clientName,
    notes,
    is_active: true,
  }
  if (coords) {
    insertData.lat = coords.lat
    insertData.lng = coords.lng
  }

  const { data, error } = await service.from("sites").insert(insertData).select("*").single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ site: data })
}
