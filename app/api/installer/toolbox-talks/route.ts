// app/api/installer/toolbox-talks/route.ts
//
// GET  ?jobId=...  the talks on this worker's job, and whether they have signed.
// POST             sign one, with the drawn mark.
//
// The signature is the evidence, so the checks here are about making it mean
// something: you can only sign a talk on a job you are assigned to, you can
// only sign as yourself, and you can only sign once. The database enforces the
// last two as well (unique constraint, and an RLS with check on user_id) --
// these are the friendly errors, not the guarantee.

import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { verifyActiveFieldToken } from "@/lib/auth"

/** An SVG data URI of drawn strokes, and nothing else. */
function validateSignature(raw: unknown): { ok: true; svg: string } | { ok: false; error: string } {
  if (typeof raw !== "string" || !raw.trim()) {
    return { ok: false, error: "Signature is missing" }
  }
  const svg = raw.trim()
  if (!svg.startsWith("data:image/svg+xml")) {
    return { ok: false, error: "Signature must be an SVG data URI" }
  }
  if (svg.length < 32) return { ok: false, error: "Signature is empty - draw your name" }
  if (svg.length > 200000) return { ok: false, error: "Signature is too large" }
  // The stored value is rendered back into admin pages and the audit pack.
  // Scripting or external references in a data URI we accepted from a device
  // would be a stored XSS with a compliance report as the delivery vehicle.
  const decoded = svg.startsWith("data:image/svg+xml;base64,")
    ? Buffer.from(svg.slice("data:image/svg+xml;base64,".length), "base64").toString("utf8")
    : decodeURIComponent(svg.slice(svg.indexOf(",") + 1))
  if (/<script|onload=|onerror=|<foreignObject|xlink:href|href\s*=|<image|<use\b/i.test(decoded)) {
    return { ok: false, error: "Signature contains markup that is not allowed" }
  }
  return { ok: true, svg }
}

export async function GET(request: Request) {
  const installer = await verifyActiveFieldToken(request)
  if (!installer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const jobId = new URL(request.url).searchParams.get("jobId")
  const service = await createServiceClient()

  let q = service
    .from("toolbox_talks")
    .select("id, job_id, title, notes, document_url, delivered_at, jobs(name), delivered_by_user:users!toolbox_talks_delivered_by_fkey(name)")
    .eq("company_id", installer.companyId)
    .is("archived_at", null)
    .order("delivered_at", { ascending: false })
    .limit(50)
  if (jobId) q = q.eq("job_id", jobId)

  const { data: talks, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!talks?.length) return NextResponse.json({ talks: [] })

  // Only talks on jobs this worker is actually on. A briefing for another crew
  // is not theirs to sign, and listing it would invite exactly that.
  const { data: mine } = await service
    .from("job_assignments")
    .select("job_id")
    .eq("user_id", installer.userId)
  const myJobs = new Set((mine || []).map((a: any) => a.job_id))

  const visible = talks.filter((t: any) => myJobs.has(t.job_id))
  if (!visible.length) return NextResponse.json({ talks: [] })

  const { data: signed } = await service
    .from("toolbox_talk_signatures")
    .select("talk_id, signed_at")
    .eq("user_id", installer.userId)
    .in("talk_id", visible.map((t: any) => t.id))
  const signedAt = new Map((signed || []).map((s: any) => [s.talk_id, s.signed_at]))

  return NextResponse.json({
    talks: visible.map((t: any) => ({
      id: t.id,
      jobId: t.job_id,
      jobName: t.jobs?.name || null,
      title: t.title,
      notes: t.notes,
      documentUrl: t.document_url,
      deliveredAt: t.delivered_at,
      deliveredBy: t.delivered_by_user?.name || null,
      signedAt: signedAt.get(t.id) || null,
    })),
  })
}

export async function POST(request: Request) {
  const installer = await verifyActiveFieldToken(request)
  if (!installer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!body?.talkId) return NextResponse.json({ error: "talkId is required" }, { status: 400 })

  const sig = validateSignature(body.signature)
  if (!sig.ok) return NextResponse.json({ error: sig.error }, { status: 400 })

  const service = await createServiceClient()

  const { data: talk } = await service
    .from("toolbox_talks")
    .select("id, company_id, job_id, archived_at")
    .eq("id", body.talkId)
    .maybeSingle()
  if (!talk || talk.company_id !== installer.companyId || talk.archived_at) {
    return NextResponse.json({ error: "Talk not found" }, { status: 404 })
  }

  const { data: assignment } = await service
    .from("job_assignments")
    .select("id")
    .eq("job_id", talk.job_id)
    .eq("user_id", installer.userId)
    .maybeSingle()
  if (!assignment) {
    return NextResponse.json({ error: "You are not assigned to this job" }, { status: 403 })
  }

  const lat = typeof body.lat === "number" && Number.isFinite(body.lat) ? body.lat : null
  const lng = typeof body.lng === "number" && Number.isFinite(body.lng) ? body.lng : null
  const accuracy =
    typeof body.accuracy === "number" && Number.isFinite(body.accuracy) ? Math.round(body.accuracy) : null

  const { data: row, error } = await service
    .from("toolbox_talk_signatures")
    .insert({
      company_id: installer.companyId,
      talk_id: talk.id,
      user_id: installer.userId,
      signature_svg: sig.svg,
      lat,
      lng,
      accuracy_metres: accuracy,
      device_info: typeof body.deviceInfo === "string" ? body.deviceInfo.slice(0, 200) : null,
    })
    .select("id, signed_at")
    .single()

  if (error) {
    // Already signed. Not an error worth alarming anyone about: report the
    // state they wanted to reach.
    if (error.code === "23505") {
      const { data: existing } = await service
        .from("toolbox_talk_signatures")
        .select("id, signed_at")
        .eq("talk_id", talk.id)
        .eq("user_id", installer.userId)
        .maybeSingle()
      return NextResponse.json({ success: true, alreadySigned: true, signedAt: existing?.signed_at })
    }
    console.error("[toolbox-talks] signature insert failed", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  console.log("[toolbox-talks] signed", talk.id, "by", installer.userId)
  return NextResponse.json({ success: true, id: row.id, signedAt: row.signed_at })
}
