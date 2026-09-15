// app/api/admin/pay-rules/route.ts
//
// GET  this company's pay rules, or the no-op set if it has never saved any.
// PUT  save them.
//
// Separate from /api/admin/settings on purpose. Settings is a flat allowlist of
// columns on companies, and pay rules are their own table with their own
// validation and their own consequence: every field here changes what somebody
// is paid. Mixing them would put "round every shift down to the hour" behind
// the same Save button as the geofence radius.

import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { getCallerContext } from "@/lib/company-context"
import { can, toPlan } from "@/lib/plan"
import { toPayRules } from "@/lib/pay"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Foreman is excluded from both reading and writing. Pay rules are an owner's
// settings; a supervisor approving hours has no business changing what those
// hours are worth.
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

  // Pay rules ride with the payroll export entitlement: they exist to make that
  // export correct, and they are meaningless without it.
  if (!can(toPlan(company?.plan), "payrollExport")) {
    return {
      error: NextResponse.json(
        { error: "Pay rules are on the Payroll plan", requiredPlan: "payroll" },
        { status: 402 },
      ),
    }
  }

  return { ctx, service, companyId: ctx.companyId }
}

export async function GET() {
  const c = await caller()
  if ("error" in c) return c.error
  const { service, companyId } = c

  const { data } = (await service
    .from("pay_rules").select("*").eq("company_id", companyId).maybeSingle()) as { data: any }

  return NextResponse.json({
    // `configured` is the row existing, not the values being non-null. A company
    // that deliberately saved "no rounding" has configured its pay rules; one
    // that has never opened the screen has not, and the UI says so differently.
    configured: Boolean(data),
    rules: toPayRules(data),
  })
}

export async function PUT(request: Request) {
  const c = await caller()
  if ("error" in c) return c.error
  const { service, companyId } = c

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  const roundTo = optionalInt(body.roundToMinutes, 1, 60)
  if (roundTo === "bad") {
    return NextResponse.json(
      { error: "Rounding must be between 1 and 60 minutes, or blank for no rounding" },
      { status: 400 },
    )
  }

  const minimum = optionalInt(body.minimumPaidMinutes, 0, 1440)
  if (minimum === "bad") {
    return NextResponse.json(
      { error: "Minimum paid shift must be between 0 and 1440 minutes, or blank" },
      { status: 400 },
    )
  }

  const breakMinutes = optionalInt(body.unpaidBreakMinutes, 0, 480)
  if (breakMinutes === "bad") {
    return NextResponse.json(
      { error: "Unpaid break must be between 0 and 480 minutes, or blank" },
      { status: 400 },
    )
  }

  // Hours, not minutes, and fractional: "over 5.5 hours" is a real policy.
  let breakAfter: number | null = null
  if (body.breakAfterHours !== null && body.breakAfterHours !== undefined && body.breakAfterHours !== "") {
    const n = Number(body.breakAfterHours)
    if (!Number.isFinite(n) || n < 0 || n > 24) {
      return NextResponse.json(
        { error: "Break threshold must be between 0 and 24 hours, or blank" },
        { status: 400 },
      )
    }
    breakAfter = Math.round(n * 100) / 100
  }

  const latenessGrace = optionalInt(body.latenessGraceMinutes, 0, 120)
  if (latenessGrace === "bad") {
    return NextResponse.json(
      { error: "Lateness grace must be between 0 and 120 minutes, or blank to not report lateness" },
      { status: 400 },
    )
  }

  const otDaily = optionalDecimal(body.overtimeDailyThresholdHours, 0.01, 24)
  if (otDaily === "bad") {
    return NextResponse.json(
      { error: "Daily overtime threshold must be between 0 and 24 hours, or blank" },
      { status: 400 },
    )
  }

  const otWeekly = optionalDecimal(body.overtimeWeeklyThresholdHours, 0.01, 168)
  if (otWeekly === "bad") {
    return NextResponse.json(
      { error: "Weekly overtime threshold must be between 0 and 168 hours, or blank" },
      { status: 400 },
    )
  }

  // Refused below 1 rather than clamped: below 1 means overtime paid worse than
  // basic, which is a typo every time -- usually 0.5 where 1.5 was meant. The
  // engine ignores such a value defensively, but the person typing it should be
  // told rather than quietly overruled.
  const otMultiplier = optionalDecimal(body.overtimeMultiplier, 1, 3)
  if (otMultiplier === "bad") {
    return NextResponse.json(
      { error: "Overtime multiplier must be between 1 and 3 (1.5 is time and a half), or blank" },
      { status: 400 },
    )
  }

  const bhMultiplier = optionalDecimal(body.bankHolidayMultiplier, 1, 3)
  if (bhMultiplier === "bad") {
    return NextResponse.json(
      { error: "Bank holiday multiplier must be between 1 and 3 (2 is double time), or blank" },
      { status: 400 },
    )
  }

  const direction = body.roundingDirection ?? "nearest"
  if (!["nearest", "up", "down"].includes(direction)) {
    return NextResponse.json({ error: "Rounding direction must be nearest, up or down" }, { status: 400 })
  }

  const row = {
    company_id: companyId,
    round_to_minutes: roundTo,
    rounding_direction: direction,
    minimum_paid_minutes: minimum,
    unpaid_break_minutes: breakMinutes,
    break_after_hours: breakAfter,
    lateness_grace_minutes: latenessGrace,
    overtime_daily_threshold_hours: otDaily,
    overtime_weekly_threshold_hours: otWeekly,
    overtime_multiplier: otMultiplier,
    bank_holiday_multiplier: bhMultiplier,
  }

  // Upsert on the primary key. The company id IS the key, so this is create or
  // replace with no chance of a second row.
  const { data, error } = (await service
    .from("pay_rules")
    .upsert(row, { onConflict: "company_id" })
    .select("*")
    .single()) as { data: any; error: any }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Logged because pay rules are the kind of setting somebody changes and then
  // does not remember changing, and a payroll total that moved needs an
  // explanation that does not depend on anyone's memory.
  console.log(
    `[pay-rules] company=${companyId} round=${row.round_to_minutes ?? "off"}` +
      `/${row.rounding_direction} minimum=${row.minimum_paid_minutes ?? "off"} ` +
      `break=${row.unpaid_break_minutes ?? "off"}@${row.break_after_hours ?? "always"} ` +
      `lateness=${row.lateness_grace_minutes ?? "off"} ` +
      `ot=${row.overtime_daily_threshold_hours ?? "-"}d/${row.overtime_weekly_threshold_hours ?? "-"}w` +
      `x${row.overtime_multiplier ?? 1} bh=x${row.bank_holiday_multiplier ?? 1}`,
  )

  return NextResponse.json({ ok: true, configured: true, rules: toPayRules(data ?? row) })
}

/**
 * An optional whole number within bounds.
 *
 * Three outcomes, not two: the value, null for "cleared", and "bad" for
 * refused. Returning null for a bad value would silently switch a rule OFF when
 * somebody fat-fingered it, which is the quiet kind of wrong this file is
 * trying to avoid.
 */
function optionalInt(raw: any, min: number, max: number): number | null | "bad" {
  if (raw === null || raw === undefined || raw === "") return null
  const n = Number(raw)
  if (!Number.isInteger(n)) return "bad"
  if (n < min || n > max) return "bad"
  return n
}

/** Like optionalInt, but for a value with decimals. Same three outcomes. */
function optionalDecimal(raw: any, min: number, max: number): number | null | "bad" {
  if (raw === null || raw === undefined || raw === "") return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return "bad"
  if (n < min || n > max) return "bad"
  return Math.round(n * 100) / 100
}
