import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { getCallerContext } from "@/lib/company-context"
import { FIELD_ROLE, FIELD_ROLES, normaliseRole } from '@/lib/roles'
import { parseRate } from "@/lib/pay"

// Accepts the legacy word on input for one release, stores the new one.
const VALID_ROLES = [...FIELD_ROLES, "foreman", "admin"]
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
  const role = (body.role || FIELD_ROLE).trim()

  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 })
  if (!email || !email.includes("@")) return NextResponse.json({ error: "Valid email required" }, { status: 400 })
  if (!VALID_ROLES.includes(role)) return NextResponse.json({ error: "Invalid role" }, { status: 400 })
  const storedRole = normaliseRole(role)

  if (role === "admin" && !CAN_ADD_ADMINS.includes(u.role)) {
    return NextResponse.json({ error: "Only the superadmin can add admins" }, { status: 403 })
  }

  const { data: existing } = await service.from("users").select("id").eq("email", email).maybeSingle()
  if (existing) return NextResponse.json({ error: "That email is already registered" }, { status: 400 })

  const { data: inserted, error } = await service.from("users").insert({
    company_id: u.company_id,
    email,
    name,
    role: storedRole,
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
/**
 * PATCH -- edit one team member.
 *
 * Only the pay rate, for now. This route deliberately does not become a general
 * "update any user field" endpoint: name, email and role each carry their own
 * consequences (an email change moves a login, a role change moves permissions)
 * and they belong behind their own checks rather than behind one open update.
 *
 * Foreman is excluded. A supervisor can see the team and the hours; what people
 * are paid is an owner's business, and the GET above already shows every column
 * to a foreman -- narrowing that is a separate job, noted here rather than done
 * silently in a commit about rates.
 */
export async function PATCH(request: Request) {
  const ctx = await getCallerContext()
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!CAN_ADD.includes(ctx.role) || !ctx.companyId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  if (!body?.userId) return NextResponse.json({ error: "userId is required" }, { status: 400 })

  const service = await createServiceClient()

  // Scoped by company as well as by id: the id comes from the client, and the
  // update below is by primary key.
  const { data: member } = await service
    .from("users")
    .select("id")
    .eq("id", body.userId)
    .eq("company_id", ctx.companyId)
    .neq("role", "support")
    .maybeSingle()
  if (!member) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const updates: Record<string, any> = {}

  if (body.hourly_rate !== undefined) {
    const parsed = parseRate(body.hourly_rate)
    if (!parsed.ok) return NextResponse.json({ error: parsed.why }, { status: 400 })
    updates.hourly_rate = parsed.rate
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 })
  }

  const { error } = await service
    .from("users")
    .update(updates)
    .eq("id", body.userId)
    .eq("company_id", ctx.companyId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
