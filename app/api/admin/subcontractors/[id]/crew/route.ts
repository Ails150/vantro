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

// POST /api/admin/subcontractors/[id]/crew
// Add a crew member (installer) to this subcontractor
export async function POST(request: Request, { params }: Params) {
  const admin = await getCallingAdmin()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id: subId } = await params

  const body = await request.json().catch(() => ({}))
  const name = (body.name || "").trim()
  const email = (body.email || "").trim().toLowerCase()
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 })
  if (!email || !email.includes("@")) return NextResponse.json({ error: "Valid email required" }, { status: 400 })

  const service = await createServiceClient()

  // Verify the subcontractor belongs to this admin's company AND has portal enabled
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

  // Email uniqueness check
  const { data: existing } = await service.from("users").select("id").eq("email", email).maybeSingle()
  if (existing) return NextResponse.json({ error: "That email is already registered" }, { status: 400 })

  const initials = name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2)

  const { data: inserted, error } = await service.from("users").insert({
    company_id: admin.company_id,
    subcontractor_id: subId,
    email,
    name,
    initials,
    role: "installer",
    is_active: true,
  }).select().single()

  if (error) {
    console.error("[subcontractors/crew] insert failed:", error)
    return NextResponse.json({ error: "Could not add crew member", detail: error.message }, { status: 400 })
  }

  // Fire the installer invite email (same flow as PAYE installers)
  try {
    const origin = new URL(request.url).origin
    await fetch(`${origin}/api/invite`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: request.headers.get("cookie") || "",
      },
      body: JSON.stringify({ email, name, role: "installer" }),
    })
  } catch (e) {
    console.error("[subcontractors/crew] invite email failed:", e)
    // Non-fatal — user is created, admin can resend invite later
  }

  return NextResponse.json({ success: true, member: inserted })
}
