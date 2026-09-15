// app/api/admin/bonuses/route.ts
//
// GET    ?from=&to=[&userId=]  bonuses in a period.
// POST                         award one.
// DELETE ?id=                  remove one.
//
// No PATCH, on purpose. A bonus is a decision somebody made on a day, and
// editing the amount afterwards leaves a record that reads as though a
// different decision was made. Removing it and awarding a new one leaves two
// honest rows instead of one rewritten one.

import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { getCallerContext } from "@/lib/company-context"
import { can, toPlan } from "@/lib/plan"
import { parseBonusAmount } from "@/lib/pay"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Same roles as pay rules. A foreman approving hours does not decide bonuses.
const PAY_ROLES = ["admin", "superadmin", "support"]

async function caller() {
  const ctx = await getCallerContext()
  if (!ctx) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  if (!PAY_ROLES.includes(ctx.role)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }
  if (!ctx.companyId) {
    return { error: NextResponse.json({ error: "No company selected" }, { status: 400 }) }
  }

  const service = await createServiceClient()
  const { data: company } = (await service
    .from("companies").select("id, plan").eq("id", ctx.companyId).single()) as { data: any }

  if (!can(toPlan(company?.plan), "payrollExport")) {
    return {
      error: NextResponse.json(
        { error: "Bonuses are on the Payroll plan", requiredPlan: "payroll" },
        { status: 402 },
      ),
    }
  }

  return { ctx, service, companyId: ctx.companyId }
}

export async function GET(request: Request) {
  const c = await caller()
  if ("error" in c) return c.error
  const { service, companyId } = c

  const url = new URL(request.url)
  const from = dateOnly(url.searchParams.get("from"))
  const to = dateOnly(url.searchParams.get("to"))
  const userId = url.searchParams.get("userId")

  let q = service
    .from("pay_bonuses")
    .select("id, user_id, amount, reason, awarded_on, created_at, users:user_id (name)")
    .eq("company_id", companyId)
    .order("awarded_on", { ascending: false })
    .limit(500)

  if (from) q = q.gte("awarded_on", from)
  if (to) q = q.lte("awarded_on", to)
  if (userId) q = q.eq("user_id", userId)

  const { data, error } = (await q) as { data: any[] | null; error: any }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    bonuses: (data || []).map((b: any) => ({
      id: b.id,
      userId: b.user_id,
      userName: b.users?.name || "Unknown",
      amount: Number(b.amount),
      reason: b.reason,
      awardedOn: b.awarded_on,
      createdAt: b.created_at,
    })),
  })
}

export async function POST(request: Request) {
  const c = await caller()
  if ("error" in c) return c.error
  const { ctx, service, companyId } = c

  const body = await request.json().catch(() => null)
  if (!body?.userId) return NextResponse.json({ error: "userId is required" }, { status: 400 })

  const parsed = parseBonusAmount(body.amount)
  if (!parsed.ok) return NextResponse.json({ error: parsed.why }, { status: 400 })

  const reason = String(body.reason ?? "").trim()
  if (!reason) {
    // Refused here as well as by the check constraint, so the admin gets the
    // reason rather than a Postgres error.
    return NextResponse.json(
      { error: "A reason is required. A bonus with no reason is a typo six months from now." },
      { status: 400 },
    )
  }
  if (reason.length > 2000) {
    return NextResponse.json({ error: "Reason is too long" }, { status: 400 })
  }

  // The worker must belong to this company. The id comes from the client.
  const { data: member } = (await service
    .from("users").select("id").eq("id", body.userId).eq("company_id", companyId).maybeSingle()) as { data: any }
  if (!member) return NextResponse.json({ error: "Worker not found" }, { status: 404 })

  const awardedOn = dateOnly(body.awardedOn) ?? todayInLondon()

  const { data, error } = (await service
    .from("pay_bonuses")
    .insert({
      company_id: companyId,
      user_id: body.userId,
      amount: parsed.amount,
      reason,
      awarded_on: awardedOn,
      created_by: ctx.userId,
    })
    .select("id")
    .single()) as { data: any; error: any }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  console.log(
    `[bonus] company=${companyId} user=${body.userId} amount=${parsed.amount} ` +
      `on=${awardedOn} by=${ctx.userId}`,
  )

  return NextResponse.json({ ok: true, id: data?.id })
}

export async function DELETE(request: Request) {
  const c = await caller()
  if ("error" in c) return c.error
  const { ctx, service, companyId } = c

  const id = new URL(request.url).searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })

  // Scoped by company: the id comes from the client.
  const { error } = await service
    .from("pay_bonuses").delete().eq("id", id).eq("company_id", companyId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  console.log(`[bonus] removed id=${id} company=${companyId} by=${ctx.userId}`)
  return NextResponse.json({ ok: true })
}

function dateOnly(raw: string | null | undefined): string | null {
  if (!raw) return null
  const d = String(raw).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null
}

function todayInLondon(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date())
}
