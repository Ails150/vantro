import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

const VALID_ROLES = ["installer", "foreman", "admin"]
const CAN_LIST = ["admin", "foreman", "superadmin"]
const CAN_ADD = ["admin", "superadmin"]
const CAN_ADD_ADMINS = ["superadmin"]

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const service = await createServiceClient()
  const { data: u } = await service.from("users").select("company_id, role").eq("auth_user_id", user.id).single()
  if (!u || !CAN_LIST.includes(u.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { data: members } = await service.from("users").select("*").eq("company_id", u.company_id).order("name")
  return NextResponse.json({ members: members || [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const service = await createServiceClient()
  const { data: u } = await service.from("users").select("company_id, role").eq("auth_user_id", user.id).single()
  if (!u || !CAN_ADD.includes(u.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

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
    return NextResponse.json({ error: "Could not add team member", detail: error.message }, { status: 400 })
  }

  return NextResponse.json({ success: true, member: inserted })
}