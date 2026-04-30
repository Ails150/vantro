import { NextRequest, NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

const STANDARD_UK_TRADES = [
  { key: "glazing", label: "Glazing", sort: 1 },
  { key: "carpentry", label: "Carpentry", sort: 2 },
  { key: "electrical", label: "Electrical", sort: 3 },
  { key: "plumbing", label: "Plumbing", sort: 4 },
  { key: "roofing", label: "Roofing", sort: 5 },
  { key: "plastering", label: "Plastering", sort: 6 },
  { key: "bricklaying", label: "Bricklaying", sort: 7 },
  { key: "painting", label: "Painting & Decorating", sort: 8 },
  { key: "tiling", label: "Tiling", sort: 9 },
  { key: "joinery", label: "Joinery", sort: 10 },
  { key: "drylining", label: "Drylining", sort: 11 },
  { key: "m_and_e", label: "M&E", sort: 12 },
  { key: "groundworks", label: "Groundworks", sort: 13 },
  { key: "landscaping", label: "Landscaping", sort: 14 },
  { key: "cleaning", label: "Cleaning", sort: 15 },
]

async function getAdmin(authUserId: string) {
  const service = await createServiceClient()
  const { data } = await service
    .from("users")
    .select("id, company_id, role")
    .eq("auth_user_id", authUserId)
    .single()
  return { service, admin: data }
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { service, admin } = await getAdmin(user.id)
  if (!admin || admin.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { data: company } = await service
    .from("companies")
    .select("multi_trade_enabled")
    .eq("id", admin.company_id)
    .single()

  const { data: trades } = await service
    .from("company_trades")
    .select("*")
    .eq("company_id", admin.company_id)
    .order("sort_order")

  return NextResponse.json({
    multi_trade_enabled: company?.multi_trade_enabled || false,
    trades: trades || [],
    standard_trades: STANDARD_UK_TRADES,
  })
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { service, admin } = await getAdmin(user.id)
  if (!admin || admin.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const { multi_trade_enabled, trades } = body

  if (typeof multi_trade_enabled === "boolean") {
    await service
      .from("companies")
      .update({ multi_trade_enabled })
      .eq("id", admin.company_id)

    if (multi_trade_enabled) {
      const { count } = await service
        .from("company_trades")
        .select("*", { count: "exact", head: true })
        .eq("company_id", admin.company_id)

      if (!count || count === 0) {
        const seed = STANDARD_UK_TRADES.map(t => ({
          company_id: admin.company_id,
          trade_key: t.key,
          label: t.label,
          enabled: true,
          sort_order: t.sort,
        }))
        await service.from("company_trades").insert(seed)
      }
    }
  }

  if (Array.isArray(trades)) {
    for (const t of trades) {
      if (!t.trade_key) continue
      await service
        .from("company_trades")
        .update({ enabled: !!t.enabled, label: t.label })
        .eq("company_id", admin.company_id)
        .eq("trade_key", t.trade_key)
    }
  }

  return GET()
}
