// app/api/installer/rams/route.ts
//
// GET  ?jobId=...  the RAMS in force for this job and whether I have signed it.
// POST             sign it.
//
// The GET answer comes from the same getRamsGate() the sign-in route uses, so
// the phone and the door can never disagree about whether someone is cleared to
// start.

import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { verifyActiveFieldToken } from "@/lib/auth"
import { getRamsGate } from "@/lib/rams"

/** Shared with toolbox talks: an SVG data URI of drawn strokes, nothing else.
 *  The value is rendered back into admin pages and the compliance report, so a
 *  data URI accepted unchecked from a handset would be a stored XSS delivered
 *  by an audit document. */
function validateSignature(raw: unknown): { ok: true; svg: string } | { ok: false; error: string } {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, error: "Signature is missing" }
  const svg = raw.trim()
  if (!svg.startsWith("data:image/svg+xml")) return { ok: false, error: "Signature must be an SVG data URI" }
  if (svg.length < 32) return { ok: false, error: "Signature is empty - draw your name" }
  if (svg.length > 200000) return { ok: false, error: "Signature is too large" }
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
  if (!jobId) return NextResponse.json({ error: "jobId is required" }, { status: 400 })

  const service = await createServiceClient()

  const { data: job } = await service
    .from("jobs").select("id, company_id, name").eq("id", jobId).maybeSingle()
  if (!job || job.company_id !== installer.companyId) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 })
  }

  const gate = await getRamsGate(service, jobId, installer.userId)

  return NextResponse.json({
    jobName: job.name,
    required: !!gate.rams,
    blocked: gate.blocked,
    reason: gate.reason,
    message: gate.message,
    previouslySignedVersion: gate.signedVersion,
    rams: gate.rams
      ? {
          id: gate.rams.id,
          version: gate.rams.version,
          title: gate.rams.title,
          notes: gate.rams.notes,
          documentUrl: gate.rams.document_url,
          createdAt: gate.rams.created_at,
        }
      : null,
  })
}

export async function POST(request: Request) {
  const installer = await verifyActiveFieldToken(request)
  if (!installer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!body?.ramsId) return NextResponse.json({ error: "ramsId is required" }, { status: 400 })

  const sig = validateSignature(body.signature)
  if (!sig.ok) return NextResponse.json({ error: sig.error }, { status: 400 })

  const service = await createServiceClient()

  const { data: doc } = await service
    .from("rams_documents")
    .select("id, company_id, job_id, version, superseded_at, archived_at")
    .eq("id", body.ramsId)
    .maybeSingle()
  if (!doc || doc.company_id !== installer.companyId || doc.archived_at) {
    return NextResponse.json({ error: "RAMS not found" }, { status: 404 })
  }

  // Signing a version that has already been replaced would clear nobody: the
  // gate asks about the version in force. Refuse and say which one to read,
  // rather than accepting a signature that does not let them start work.
  if (doc.superseded_at) {
    return NextResponse.json(
      {
        error:
          "That version of the RAMS has been replaced. Pull down to refresh and sign the current version.",
        superseded: true,
      },
      { status: 409 },
    )
  }

  const { data: assignment } = await service
    .from("job_assignments")
    .select("id")
    .eq("job_id", doc.job_id)
    .eq("user_id", installer.userId)
    .maybeSingle()
  if (!assignment) {
    return NextResponse.json({ error: "You are not assigned to this job" }, { status: 403 })
  }

  const readSeconds =
    typeof body.readSeconds === "number" && Number.isFinite(body.readSeconds) && body.readSeconds >= 0
      ? Math.min(Math.round(body.readSeconds), 86400)
      : null

  const { data: row, error } = await service
    .from("rams_signatures")
    .insert({
      company_id: installer.companyId,
      rams_id: doc.id,
      user_id: installer.userId,
      signature_svg: sig.svg,
      read_seconds: readSeconds,
      lat: typeof body.lat === "number" && Number.isFinite(body.lat) ? body.lat : null,
      lng: typeof body.lng === "number" && Number.isFinite(body.lng) ? body.lng : null,
      accuracy_metres:
        typeof body.accuracy === "number" && Number.isFinite(body.accuracy)
          ? Math.round(body.accuracy)
          : null,
      device_info: typeof body.deviceInfo === "string" ? body.deviceInfo.slice(0, 200) : null,
    })
    .select("id, signed_at")
    .single()

  if (error) {
    if (error.code === "23505") {
      const { data: existing } = await service
        .from("rams_signatures")
        .select("id, signed_at")
        .eq("rams_id", doc.id)
        .eq("user_id", installer.userId)
        .maybeSingle()
      return NextResponse.json({ success: true, alreadySigned: true, signedAt: existing?.signed_at })
    }
    console.error("[rams] signature insert failed", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  console.log("[rams] v" + doc.version, "signed for job", doc.job_id, "by", installer.userId)
  return NextResponse.json({ success: true, id: row.id, signedAt: row.signed_at, version: doc.version })
}
