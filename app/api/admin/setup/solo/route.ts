// app/api/admin/setup/solo/route.ts
//
// POST { pin }  -- "It's just me": make the owner their own first worker.
//
// A sole trader is the company and the crew. Until now the product made them
// invite themselves: add a second person, send an email to their own address,
// open it on the phone, set a PIN, come back and tick a box on an assignment
// matrix. Every one of those steps exists to coordinate people who are not in
// the same head.
//
// This does the three things that actually have to be true, in one call:
//   1. the account is marked as working on site (users.works_on_site), which
//      is what lets an office role hold a PIN at all;
//   2. a PIN is set, chosen here, in a session that already proves who they
//      are -- no email round trip, no reset link, no window in which anybody
//      who knows the address can set one;
//   3. they are assigned to the company's active jobs, because a worker with
//      no assignment sees an empty app and is told nothing about why.
//
// The PIN is set through an authenticated session on purpose. That is the one
// safe way to put a PIN on an office account: setup-pin and Forgot PIN both
// refuse, because they identify a person only by an email address.

import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { createServiceClient } from "@/lib/supabase/server"
import { getCallerContext, OWNER_ROLES } from "@/lib/company-context"
import { maybeCompleteSetup } from "@/lib/setup-complete"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const ctx = await getCallerContext()
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  // Owners only, and only for themselves: there is no user id in the body.
  if (!(OWNER_ROLES as readonly string[]).includes(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (!ctx.companyId) return NextResponse.json({ error: "No company selected" }, { status: 400 })
  // A support user acting inside somebody else's company must not hand
  // themselves a field credential there.
  if (ctx.isSupport) return NextResponse.json({ error: "Not available in support mode" }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const pin = String(body.pin ?? "")
  if (!/^\d{4}$/.test(pin)) {
    return NextResponse.json({ error: "Choose a 4-digit PIN" }, { status: 400 })
  }
  // The four PINs that are not a PIN. A credential that opens somebody's
  // attendance record should survive one guess from a person holding the phone.
  if (/^(\d)\1{3}$/.test(pin) || ["1234", "4321", "0123"].includes(pin)) {
    return NextResponse.json({ error: "Pick a less obvious PIN" }, { status: 400 })
  }

  const service = await createServiceClient()
  const { error: updateErr } = await service
    .from("users")
    .update({
      works_on_site: true,
      pin_hash: await bcrypt.hash(pin, 10),
      pin_attempts: 0,
      pin_locked_until: null,
      pin_reset_token: null,
      pin_reset_expires: null,
    })
    .eq("id", ctx.userId)
    .eq("company_id", ctx.companyId)
  if (updateErr) {
    console.error("[setup/solo] could not set the owner up as a worker:", updateErr.message)
    return NextResponse.json({ error: "Could not set that up" }, { status: 500 })
  }

  // Every active job, not just the newest: a solo trader with two jobs on the
  // go wants both, and there is nobody else to assign them to.
  const { data: jobs } = await service
    .from("jobs")
    .select("id")
    .eq("company_id", ctx.companyId)
    .eq("status", "active")
    .is("archived_at", null)
    .limit(200)

  const { data: existing } = await service
    .from("job_assignments")
    .select("job_id")
    .eq("company_id", ctx.companyId)
    .eq("user_id", ctx.userId)
  const already = new Set((existing || []).map((a: any) => a.job_id))

  const toAdd = (jobs || [])
    .filter((j: any) => !already.has(j.id))
    .map((j: any) => ({ company_id: ctx.companyId, job_id: j.id, user_id: ctx.userId }))

  let assigned = 0
  if (toAdd.length) {
    const { error: assignErr } = await service.from("job_assignments").insert(toAdd)
    // The PIN is set either way; an assignment that failed is recoverable from
    // the dashboard and must not read as "that did not work".
    if (assignErr) console.error("[setup/solo] assignment failed:", assignErr.message)
    else assigned = toAdd.length
  }

  // If they did this after adding their job, they are done.
  await maybeCompleteSetup(service, ctx.companyId)

  console.log(`[setup/solo] company=${ctx.companyId} owner set up as a worker, ${assigned} job(s) assigned`)
  return NextResponse.json({ ok: true, assignedJobs: assigned + already.size })
}
