import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

// Bulk import installers/foremen via CSV.
//   POST /api/admin/team/bulk-import
//   body: { rows: [{ name: string, email: string, role: "installer" | "foreman" }] }
//
// Returns per-row results so the UI can show which succeeded and which didn't.

const VALID_ROLES = ["installer", "foreman"] as const

interface CsvRow {
  name: string
  email: string
  role: string
}

interface RowResult {
  row: number
  name: string
  email: string
  status: "created" | "skipped" | "error"
  message?: string
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

  // Pre-check installer limit if set
  const { data: company } = await service
    .from("companies")
    .select("installer_limit")
    .eq("id", admin.company_id)
    .single()

  if (company?.installer_limit) {
    // active_team_count_v1: only count active installer/foreman users
    const { count: currentCount } = await service
      .from("users")
      .select("*", { count: "exact", head: true })
      .eq("company_id", admin.company_id)
      .in("role", ["installer", "foreman"])
      .eq("is_active", true)
    if (currentCount !== null && currentCount + rows.length > company.installer_limit) {
      return NextResponse.json(
        { error: `Importing ${rows.length} would exceed your installer limit of ${company.installer_limit}. You currently have ${currentCount}.` },
        { status: 400 }
      )
    }
  }

  // Get existing emails in this company to detect duplicates
  const incomingEmails = rows
    .map((r) => (r?.email || "").trim().toLowerCase())
    .filter((e) => e.length > 0)
  const { data: existing } = await service
    .from("users")
    .select("email")
    .eq("company_id", admin.company_id)
    .in("email", incomingEmails)
  const existingSet = new Set((existing || []).map((u) => (u.email || "").toLowerCase()))

  const results: RowResult[] = []
  const toInsert: any[] = []

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const rowNum = i + 1
    const name = (r?.name || "").trim()
    const email = (r?.email || "").trim().toLowerCase()
    const role = (r?.role || "installer").trim().toLowerCase()

    if (!name) {
      results.push({ row: rowNum, name: "", email, status: "error", message: "Missing name" })
      continue
    }
    if (!email) {
      results.push({ row: rowNum, name, email: "", status: "error", message: "Missing email" })
      continue
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      results.push({ row: rowNum, name, email, status: "error", message: "Invalid email" })
      continue
    }
    if (!VALID_ROLES.includes(role as any)) {
      results.push({ row: rowNum, name, email, status: "error", message: `Role must be one of: ${VALID_ROLES.join(", ")}` })
      continue
    }
    if (existingSet.has(email)) {
      results.push({ row: rowNum, name, email, status: "skipped", message: "Email already exists" })
      continue
    }

    const initials = name
      .split(/\s+/)
      .map((n) => n[0] || "")
      .join("")
      .toUpperCase()
      .slice(0, 2)

    toInsert.push({
      company_id: admin.company_id,
      name,
      email,
      initials,
      role,
      is_active: true,
    })
    results.push({ row: rowNum, name, email, status: "created" })
    existingSet.add(email) // prevent duplicate within the same import
  }

  if (toInsert.length > 0) {
    const { error: insertError } = await service.from("users").insert(toInsert)
    if (insertError) {
      // If batch insert fails, mark all created entries as errors
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
