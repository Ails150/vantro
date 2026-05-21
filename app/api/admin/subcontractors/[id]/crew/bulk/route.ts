import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

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
  if (!["admin", "superadmin"].includes(row.role)) return null
  return row
}

interface Params {
  params: Promise<{ id: string }>
}

// POST /api/admin/subcontractors/[id]/crew/bulk
// Bulk-add crew members from CSV
export async function POST(request: Request, { params }: Params) {
  const admin = await getCallingAdmin()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id: subId } = await params

  const body = await request.json().catch(() => ({}))
  const rows: Array<{name: string; email: string}> = Array.isArray(body.rows) ? body.rows : []
  if (rows.length === 0) return NextResponse.json({ error: "No rows provided" }, { status: 400 })
  if (rows.length > 500) return NextResponse.json({ error: "Too many rows (max 500)" }, { status: 400 })

  const service = await createServiceClient()

  // Verify sub belongs to admin's company AND has portal enabled
  const { data: sub } = await service
    .from("subcontractors")
    .select("id, company_id, portal_enabled, active")
    .eq("id", subId)
    .single()
  if (!sub || sub.company_id !== admin.company_id) {
    return NextResponse.json({ error: "Subcontractor not found" }, { status: 404 })
  }
  if (!sub.portal_enabled) {
    return NextResponse.json({ error: "Enable Crew portal access on this subcontractor first" }, { status: 400 })
  }
  if (!sub.active) {
    return NextResponse.json({ error: "This subcontractor is inactive" }, { status: 400 })
  }

  // Pre-fetch existing emails for fast dedup
  const emails = rows.map(r => (r.email || "").toLowerCase().trim()).filter(Boolean)
  const { data: existingRows } = await service.from("users").select("email").in("email", emails)
  const existingEmails = new Set((existingRows || []).map(r => (r.email || "").toLowerCase()))

  const added: Array<{id: string; name: string; email: string}> = []
  const failed: Array<{email: string; reason: string}> = []
  const origin = new URL(request.url).origin
  const cookieHeader = request.headers.get("cookie") || ""

  for (const row of rows) {
    const name = (row.name || "").trim()
    const email = (row.email || "").trim().toLowerCase()

    if (!name) { failed.push({ email: email || "(blank)", reason: "Missing name" }); continue }
    if (!email || !email.includes("@")) { failed.push({ email: email || "(blank)", reason: "Invalid email" }); continue }
    if (existingEmails.has(email)) { failed.push({ email, reason: "Already registered" }); continue }

    const initials = name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)

    const { data: inserted, error } = await service.from("users").insert({
      company_id: admin.company_id,
      subcontractor_id: subId,
      email,
      name,
      initials,
      role: "installer",
      is_active: true,
    }).select("id").single()

    if (error || !inserted) {
      failed.push({ email, reason: error?.message || "Insert failed" })
      continue
    }

    added.push({ id: inserted.id, name, email })
    existingEmails.add(email) // prevent dupes within the same batch

    // Fire invite email (non-blocking failures)
    try {
      await fetch(`${origin}/api/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: cookieHeader },
        body: JSON.stringify({ email, name, role: "installer" }),
      })
    } catch (e) {
      console.error("[crew/bulk] invite failed for", email, e)
    }
  }

  return NextResponse.json({ success: true, added: added.length, failed, added_members: added })
}
