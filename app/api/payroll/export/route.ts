import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

// Payroll CSV export with row locking.
//   GET  /api/payroll/export?from=ISO&to=ISO&preview=true   → preview totals (no lock)
//   POST /api/payroll/export  body: { from, to }            → finalise + return CSV (locks rows)
//
// On finalise:
//   - Each signin in the range gets payroll_exported_at = now() and payroll_export_id = <new id>
//   - Once locked, signins cannot be edited via the payroll edit endpoint
//   - Audit row created in payroll_exports table
//   - Returns CSV file directly

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function csvEscape(value: any): string {
  if (value === null || value === undefined) return ""
  const s = String(value)
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

async function fetchSignins(service: any, companyId: string, from: string, to: string, onlyUnexported: boolean) {
  let q = service
    .from("signins")
    .select(`
      id,
      user_id,
      job_id,
      signed_in_at,
      signed_out_at,
      hours_worked,
      auto_closed,
      flagged,
      payroll_exported_at,
      users:user_id (id, name, email),
      jobs:job_id (id, name)
    `)
    .eq("company_id", companyId)
    .gte("signed_in_at", from)
    .lte("signed_in_at", to)
    .order("signed_in_at", { ascending: true })

  if (onlyUnexported) {
    q = q.is("payroll_exported_at", null)
  }

  const { data, error } = await q
  if (error) throw error
  return data || []
}

function calculateHours(signin: any): number {
  if (signin.hours_worked != null) return Number(signin.hours_worked)
  if (signin.signed_in_at && signin.signed_out_at) {
    return (new Date(signin.signed_out_at).getTime() - new Date(signin.signed_in_at).getTime()) / 3600000
  }
  return 0
}

// ─── GET: preview totals (no lock) ──────────────────────────────
export async function GET(request: Request) {
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

  const { searchParams } = new URL(request.url)
  const from = searchParams.get("from")
  const to = searchParams.get("to")
  if (!from || !to) {
    return NextResponse.json({ error: "from and to date params required" }, { status: 400 })
  }

  const signins = await fetchSignins(service, admin.company_id, from, to, true)

  // Aggregate by user
  const byUser = new Map<string, { user: any; sessions: number; hours: number; flagged: number }>()
  let totalHours = 0
  let flaggedCount = 0
  for (const s of signins) {
    const hrs = calculateHours(s)
    totalHours += hrs
    if (s.flagged) flaggedCount++
    const key = s.user_id
    const existing = byUser.get(key) || { user: s.users, sessions: 0, hours: 0, flagged: 0 }
    existing.sessions++
    existing.hours += hrs
    if (s.flagged) existing.flagged++
    byUser.set(key, existing)
  }

  return NextResponse.json({
    summary: {
      signinCount: signins.length,
      totalHours: Number(totalHours.toFixed(2)),
      flaggedCount,
      uniqueInstallers: byUser.size,
    },
    byInstaller: Array.from(byUser.values())
      .map((v) => ({
        installer: v.user?.name || "Unknown",
        email: v.user?.email || "",
        sessions: v.sessions,
        hours: Number(v.hours.toFixed(2)),
        flagged: v.flagged,
      }))
      .sort((a, b) => a.installer.localeCompare(b.installer)),
  })
}

// ─── POST: finalise + return CSV ──────────────────────────────
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

  const body = await request.json().catch(() => ({}))
  const { from, to } = body
  if (!from || !to) {
    return NextResponse.json({ error: "from and to required" }, { status: 400 })
  }

  // Fetch only unexported signins in range
  const signins = await fetchSignins(service, admin.company_id, from, to, true)

  if (signins.length === 0) {
    return NextResponse.json({ error: "No new signins in this range to export" }, { status: 400 })
  }

  const totalHours = signins.reduce((acc, s) => acc + calculateHours(s), 0)

  // Create payroll_exports audit row
  const { data: exportRow, error: exportErr } = await service
    .from("payroll_exports")
    .insert({
      company_id: admin.company_id,
      exported_by: admin.id,
      date_from: from,
      date_to: to,
      signin_count: signins.length,
      total_hours: Number(totalHours.toFixed(2)),
    })
    .select("id")
    .single()

  if (exportErr || !exportRow) {
    return NextResponse.json({ error: "Could not create export record", detail: exportErr?.message }, { status: 500 })
  }

  // LOCK signins — set payroll_exported_at and payroll_export_id
  const signinIds = signins.map((s: any) => s.id)
  const { error: lockErr } = await service
    .from("signins")
    .update({
      payroll_exported_at: new Date().toISOString(),
      payroll_export_id: exportRow.id,
    })
    .in("id", signinIds)

  if (lockErr) {
    // Roll back export row
    await service.from("payroll_exports").delete().eq("id", exportRow.id)
    return NextResponse.json({ error: "Could not lock signins", detail: lockErr.message }, { status: 500 })
  }

  // Build CSV
  const header = [
    "Installer",
    "Email",
    "Job",
    "Date",
    "Sign In",
    "Sign Out",
    "Hours",
    "Auto Closed",
    "Flagged",
  ]
  const lines = [header.join(",")]
  for (const s of signins as any[]) {
    const signedIn = s.signed_in_at ? new Date(s.signed_in_at) : null
    const signedOut = s.signed_out_at ? new Date(s.signed_out_at) : null
    const hours = calculateHours(s)
    lines.push([
      csvEscape(s.users?.name || ""),
      csvEscape(s.users?.email || ""),
      csvEscape(s.jobs?.name || ""),
      csvEscape(signedIn ? signedIn.toLocaleDateString("en-GB") : ""),
      csvEscape(signedIn ? signedIn.toLocaleString("en-GB") : ""),
      csvEscape(signedOut ? signedOut.toLocaleString("en-GB") : ""),
      csvEscape(hours.toFixed(2)),
      csvEscape(s.auto_closed ? "Yes" : "No"),
      csvEscape(s.flagged ? "Yes" : "No"),
    ].join(","))
  }

  const csv = lines.join("\n")
  const filename = `vantro-payroll-${from.slice(0, 10)}-to-${to.slice(0, 10)}.csv`

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Export-Id": exportRow.id,
      "X-Signin-Count": String(signins.length),
      "X-Total-Hours": totalHours.toFixed(2),
    },
  })
}
