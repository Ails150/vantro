import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { getCallerContext } from "@/lib/company-context"

const VALID_ROLES = ["installer", "foreman", "admin"]
const CAN_LIST = ["admin", "foreman", "superadmin", "support"]
const CAN_ADD = ["admin", "superadmin", "support"]
const CAN_ADD_ADMINS = ["superadmin"]

export async function GET() {
  const ctx = await getCallerContext()
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!CAN_LIST.includes(ctx.role) || !ctx.companyId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const service = await createServiceClient()
  // Platform support users are never shown as company team members.
  const { data: members } = await service.from("users").select("*").eq("company_id", ctx.companyId).neq("role", "support").order("name")
  return NextResponse.json({ members: members || [] })
}

export async function POST(request: Request) {
  const ctx = await getCallerContext()
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!CAN_ADD.includes(ctx.role) || !ctx.companyId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const u = { company_id: ctx.companyId, role: ctx.role }

  const service = await createServiceClient()
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  const name = (body.name || "").trim()
  const email = (body.email || "").trim().toLowerCase()
  const role = (body.role || "installer").trim()

  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 })
  if (!email || !email.includes("@")) return NextResponse.json({ error: "Valid email required" }, { status: 400 })
  if (!VALID_ROLES.includes(role)) return NextResponse.json({ error: "Invalid role" }, { status: 400 })

  if (role === "admin" && !CAN_ADD_ADMINS.includes(u.role)) {
    return NextResponse.json({ error: "Only the superadmin can add admins" }, { status: 403 })
  }

  const { data: existing } = await service.from("users").select("id").eq("email", email).maybeSingle()
  if (existing) return NextResponse.json({ error: "That email is already registered" }, { status: 400 })

  const { data: inserted, error } = await service.from("users").insert({
    company_id: u.company_id,
    email,
    name,
    role,
    is_active: true,
  }).select().single()

  if (error) {
    console.error("[admin/team] insert failed:", error)
    if (error.code === "23505") {
      return NextResponse.json({ error: "This email is already registered." }, { status: 400 })
    }
    return NextResponse.json({ error: "Could not add team member", detail: error.message }, { status: 400 })
  }

  return NextResponse.json({ success: true, member: inserted })
}