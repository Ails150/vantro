// app/api/join/route.ts
//
// A worker joining from a shared invite link.
//
//   GET  /api/join?token=...              -> whose team is this? (name only)
//   POST /api/join { token, name, email } -> create the worker, sign them in
//
// No password, no PIN, no email round trip. The worker taps the link their
// supervisor pasted into WhatsApp, types their name, and is on the jobs list.
// Anything longer than that and half of a five-person crew never finishes
// signing up, which is the thing that kills a free tier.
//
// The token they arrive with proves which company they are joining and nothing
// else -- it cannot name them, promote them, or reach another tenant.

import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { createFieldToken, verifyInviteToken } from "@/lib/auth"
import { checkRateLimit, getClientIp } from "@/lib/rate-limit"
import { getInitials } from "@/lib/provisioning"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const EXPIRED =
  "This invite link has expired. Ask your manager to send you a new one."

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token")
  const invite = token ? verifyInviteToken(token) : null
  if (!invite) return NextResponse.json({ error: EXPIRED }, { status: 401 })

  const service = await createServiceClient()
  const { data: company } = await service
    .from("companies")
    .select("name")
    .eq("id", invite.companyId)
    .single()

  if (!company) return NextResponse.json({ error: EXPIRED }, { status: 401 })
  // Only the company name. This endpoint is reachable by anyone holding the
  // link, so it must not become a way to enumerate a tenant's people or jobs.
  return NextResponse.json({ companyName: company.name })
}

export async function POST(request: Request) {
  const ip = getClientIp(request)
  // A shared link cannot be revoked per person, so the rate limit is the thing
  // standing between a leaked link and someone filling a company with rows.
  if (!(await checkRateLimit(`join:ip:${ip}`, 10, 3600))) {
    return NextResponse.json(
      { error: "Too many attempts from this connection. Try again later." },
      { status: 429 },
    )
  }

  const body = await request.json().catch(() => ({}))
  const { token, name, email } = body as { token?: string; name?: string; email?: string }

  const invite = token ? verifyInviteToken(token) : null
  if (!invite) return NextResponse.json({ error: EXPIRED }, { status: 401 })

  const fullName = String(name || "").trim()
  if (fullName.length < 2) {
    return NextResponse.json({ error: "Please enter your name." }, { status: 400 })
  }

  const service = await createServiceClient()
  const cleanEmail = String(email || "").trim().toLowerCase() || null

  // Rejoining is not an error. A worker who clears their browser, changes
  // phone, or taps the link twice should land back on their own record rather
  // than become a second person on the payroll report.
  let existing: any = null
  if (cleanEmail) {
    const { data } = await service
      .from("users")
      .select("id, company_id, is_active")
      .eq("company_id", invite.companyId)
      .eq("email", cleanEmail)
      .maybeSingle()
    existing = data
  }

  let userId: string
  if (existing) {
    userId = existing.id
    if (existing.is_active === false) {
      await service.from("users").update({ is_active: true }).eq("id", userId)
    }
  } else {
    const { data: created, error } = await service
      .from("users")
      .insert({
        company_id: invite.companyId,
        email: cleanEmail,
        name: fullName,
        initials: getInitials(fullName),
        role: "installer",
        is_active: true,
      })
      .select("id")
      .single()

    if (error || !created) {
      console.error("[join] worker insert failed:", error)
      return NextResponse.json({ error: "Could not add you to the team." }, { status: 500 })
    }
    userId = created.id
  }

  // Persistent, because this worker has no password and no PIN to fall back
  // on. See FieldTokenLife in lib/auth.
  const fieldToken = createFieldToken(userId, invite.companyId, null, "persistent")

  return NextResponse.json({ token: fieldToken, userId, name: fullName })
}
