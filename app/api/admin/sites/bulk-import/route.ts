import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

// Bulk import sites (reusable client/address templates) via CSV.
//   POST /api/admin/sites/bulk-import
//   body: { rows: [{ name, address, postcode?, client_name?, notes? }] }
//
// Sites are reusable templates — useful for housing developers, repeat clients,
// retail rollouts. When creating a job, you can pick from saved sites.

interface CsvRow {
  name: string
  address: string
  postcode?: string
  client_name?: string
  notes?: string
}

interface RowResult {
  row: number
  name: string
  status: "created" | "skipped" | "error"
  message?: string
}

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

export async function POST(request: Request) {
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

  let body: { rows?: CsvRow[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const rows = body.rows
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "rows must be a non-empty array" }, { status: 400 })
  }
  if (rows.length > 500) {
    return NextResponse.json({ error: "Max 500 rows per import" }, { status: 400 })
  }

  // Existing site names in this company
  const incomingNames = rows.map((r) => (r?.name || "").trim()).filter((n) => n.length > 0)
  const { data: existing } = await service
    .from("sites")
    .select("name")
    .eq("company_id", admin.company_id)
    .in("name", incomingNames)
  const existingSet = new Set((existing || []).map((s: any) => (s.name || "").trim().toLowerCase()))

  const results: RowResult[] = []
  const toInsert: any[] = []

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const rowNum = i + 1
    const name = (r?.name || "").trim()
    const address = (r?.address || "").trim()
    const postcode = (r?.postcode || "").trim() || undefined
    const clientName = (r?.client_name || "").trim() || undefined
    const notes = (r?.notes || "").trim() || undefined

    if (!name) {
      results.push({ row: rowNum, name: "", status: "error", message: "Missing name" })
      continue
    }
    if (!address) {
      results.push({ row: rowNum, name, status: "error", message: "Missing address" })
      continue
    }
    if (existingSet.has(name.toLowerCase())) {
      results.push({ row: rowNum, name, status: "skipped", message: "Site already exists" })
      continue
    }

    const coords = await geocodeAddress(address, postcode)
    const insertRow: any = {
      company_id: admin.company_id,
      name,
      address,
      postcode,
      client_name: clientName,
      notes,
      is_active: true,
    }
    if (coords) {
      insertRow.lat = coords.lat
      insertRow.lng = coords.lng
    }

    toInsert.push(insertRow)
    results.push({ row: rowNum, name, status: "created" })
    existingSet.add(name.toLowerCase())
  }

  if (toInsert.length > 0) {
    const { error: insertError } = await service.from("sites").insert(toInsert)
    if (insertError) {
      for (const r of results) {
        if (r.status === "created") {
          r.status = "error"
          r.message = insertError.message
        }
      }
      return NextResponse.json({ results, summary: summarise(results) }, { status: 500 })
    }
  }

  return NextResponse.json({ results, summary: summarise(results) })
}

function summarise(results: RowResult[]) {
  return {
    total: results.length,
    created: results.filter((r) => r.status === "created").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    errored: results.filter((r) => r.status === "error").length,
  }
}
