// app/api/admin/incidents/route.ts
//
// GET   ?status=open|all&jobId=...   incidents for the company.
// PATCH                              acknowledge or close one.
//
// An admin may write the acknowledgement and the closure and nothing else. The
// worker's account of what happened is immutable at the database level too
// (incidents_report_immutable); this route simply never tries.

import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

const MANAGER_ROLES = ["admin", "foreman", "superadmin"]

async function caller() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  const service = await createServiceClient()
  const { data: me } = await service
    .from("users").select("id, company_id, role").eq("auth_user_id", user.id).single()
  if (!me || !MANAGER_ROLES.includes(me.role)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }
  return { me, service }
}

export async function GET(request: Request) {
  const c = await caller()
  if ("error" in c) return c.error
  const { me, service } = c

  const url = new URL(request.url)
  const status = url.searchParams.get("status") || "open"
  const jobId = url.searchParams.get("jobId")

  let q = service
    .from("incidents")
    .select(
      "id, job_id, kind, description, photo_urls, occurred_at, reported_at, lat, lng, status, " +
        "acknowledged_at, closed_at, closure_notes, " +
        "reporter:users!incidents_reported_by_fkey(id, name), " +
        "ack:users!incidents_acknowledged_by_fkey(name), " +
        "closer:users!incidents_closed_by_fkey(name), jobs(id, name)",
    )
    .eq("company_id", me.company_id)
    .order("reported_at", { ascending: false })
    .limit(200)

  // "open" means everything not yet closed, acknowledged included: an
  // acknowledged incident is still a live problem, and dropping it off the list
  // the moment somebody clicked a button is how things get forgotten.
  if (status === "open") q = q.neq("status", "closed")
  if (jobId) q = q.eq("job_id", jobId)

  const { data, error } = (await q) as { data: any[] | null; error: any }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    incidents: (data || []).map((i: any) => ({
      id: i.id,
      jobId: i.job_id,
      jobName: i.jobs?.name || null,
      kind: i.kind,
      description: i.description,
      photoUrls: i.photo_urls || [],
      occurredAt: i.occurred_at,
      reportedAt: i.reported_at,
      reportedBy: i.reporter?.name || "Unknown",
      hasLocation: i.lat != null && i.lng != null,
      status: i.status,
      acknowledgedAt: i.acknowledged_at,
      acknowledgedBy: i.ack?.name || null,
      closedAt: i.closed_at,
      closedBy: i.closer?.name || null,
      closureNotes: i.closure_notes,
    })),
  })
}

export async function PATCH(request: Request) {
  const c = await caller()
  if ("error" in c) return c.error
  const { me, service } = c

  const body = await request.json().catch(() => null)
  if (!body?.id || !body?.action) {
    return NextResponse.json({ error: "id and action are required" }, { status: 400 })
  }
  if (!["acknowledge", "close"].includes(body.action)) {
    return NextResponse.json({ error: "action must be acknowledge or close" }, { status: 400 })
  }

  const { data: incident } = await service
    .from("incidents")
    .select("id, company_id, status")
    .eq("id", body.id)
    .maybeSingle()
  if (!incident || incident.company_id !== me.company_id) {
    return NextResponse.json({ error: "Incident not found" }, { status: 404 })
  }
  if (incident.status === "closed") {
    return NextResponse.json({ error: "That incident is already closed" }, { status: 409 })
  }

  const now = new Date().toISOString()
  let update: Record<string, any>

  if (body.action === "acknowledge") {
    update = { status: "acknowledged", acknowledged_by: me.id, acknowledged_at: now }
  } else {
    const notes = String(body.closureNotes || "").trim()
    // The database refuses a closure with no note. Checking here too is not
    // duplication for its own sake: a constraint violation reaches the admin as
    // a wall of Postgres, and "say what was done about it" is the actual ask.
    if (!notes) {
      return NextResponse.json(
        { error: "Say what was done about it. The closure note is the only part anyone reads later." },
        { status: 400 },
      )
    }
    if (notes.length > 8000) {
      return NextResponse.json({ error: "That note is too long (8000 characters max)" }, { status: 400 })
    }
    update = {
      status: "closed",
      closed_by: me.id,
      closed_at: now,
      closure_notes: notes,
      // Closing without a prior acknowledgement is normal for something dealt
      // with on the spot; record the acknowledgement rather than leaving a gap.
      ...(incident.status === "open" ? { acknowledged_by: me.id, acknowledged_at: now } : {}),
    }
  }

  const { error } = await service.from("incidents").update(update).eq("id", body.id)
  if (error) {
    console.error("[incidents] update failed", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  console.log("[incidents]", body.action, body.id, "by", me.id)
  return NextResponse.json({ success: true })
}
