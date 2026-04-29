import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

// Bulk import jobs via CSV.
//   POST /api/admin/jobs/bulk-import
//   body: { rows: [{ name, address, postcode?, foreman_email?, gps_radius?, start_date?, end_date? }] }
//
// Returns per-row results.

interface CsvRow {
  name: string
  address: string
  postcode?: string
  foreman_email?: string
  gps_radius?: string | number
  start_date?: string
  end_date?: string
}

interface RowResult {
  row: number
  name: string
  address: string
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
  } catch {
    /* swallow geocode failures — address is still saved */
  }
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
  if (rows.length > 200) {
    return NextResponse.json({ error: "Max 200 rows per import" }, { status: 400 })
  }

  // Resolve foreman emails to user IDs (for foreman assignment)
  const foremanEmails = rows
    .map((r) => (r?.foreman_email || "").trim().toLowerCase())
    .filter((e) => e.length > 0)

  let foremanMap = new Map<string, string>()
  if (foremanEmails.length > 0) {
    const { data: foremen } = await service
      .from("users")
      .select("id, email")
      .eq("company_id", admin.company_id)
      .in("role", ["foreman", "admin"])
      .in("email", foremanEmails)
    foremanMap = new Map((foremen || []).map((f: any) => [(f.email || "").toLowerCase(), f.id]))
  }

  // Existing job names in this company (to detect duplicates)
  const incomingNames = rows
    .map((r) => (r?.name || "").trim())
    .filter((n) => n.length > 0)
  const { data: existing } = await service
    .from("jobs")
    .select("name")
    .eq("company_id", admin.company_id)
    .in("name", incomingNames)
  const existingSet = new Set((existing || []).map((j: any) => (j.name || "").trim().toLowerCase()))

  const results: RowResult[] = []
  const toInsert: any[] = []

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const rowNum = i + 1
    const name = (r?.name || "").trim()
    const address = (r?.address || "").trim()
    const postcode = (r?.postcode || "").trim() || undefined
    const foremanEmail = (r?.foreman_email || "").trim().toLowerCase() || undefined
    const gpsRadius = r?.gps_radius ? Number(r.gps_radius) : 150 // default 150m

    if (!name) {
      results.push({ row: rowNum, name: "", address, status: "error", message: "Missing name" })
      continue
    }
    if (!address) {
      results.push({ row: rowNum, name, address: "", status: "error", message: "Missing address" })
      continue
    }
    if (gpsRadius && (gpsRadius < 50 || gpsRadius > 5000)) {
      results.push({ row: rowNum, name, address, status: "error", message: "GPS radius must be 50–5000 metres" })
      continue
    }
    if (existingSet.has(name.toLowerCase())) {
      results.push({ row: rowNum, name, address, status: "skipped", message: "Job with this name already exists" })
      continue
    }
    if (foremanEmail && !foremanMap.has(foremanEmail)) {
      results.push({ row: rowNum, name, address, status: "error", message: `Foreman email '${foremanEmail}' not found in your team` })
      continue
    }

    // Geocode (best effort — don't fail row if geocoding fails)
    const coords = await geocodeAddress(address, postcode)

    const insertRow: any = {
      company_id: admin.company_id,
      name,
      address: postcode ? `${address}, ${postcode}` : address,
      status: "active",
      gps_radius: gpsRadius,
    }
    if (coords) {
      insertRow.lat = coords.lat
      insertRow.lng = coords.lng
    }
    if (foremanEmail) {
      insertRow.foreman_id = foremanMap.get(foremanEmail)
    }
    if (r.start_date) {
      const d = new Date(r.start_date)
      if (!isNaN(d.getTime())) insertRow.start_date = d.toISOString()
    }
    if (r.end_date) {
      const d = new Date(r.end_date)
      if (!isNaN(d.getTime())) insertRow.end_date = d.toISOString()
    }

    toInsert.push(insertRow)
    results.push({ row: rowNum, name, address, status: "created" })
    existingSet.add(name.toLowerCase())
  }

  if (toInsert.length > 0) {
    const { error: insertError } = await service.from("jobs").insert(toInsert)
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
