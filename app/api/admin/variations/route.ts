// app/api/admin/variations/route.ts
//
// GET    every variation and daywork on this company, with where each one is:
//        its price, the link that went out, the decision that came back, and
//        the payment application it landed on.
// PATCH  { id, action: "approve", price, notes? }   price it and approve it
//        { id, action: "reject", notes }            refuse it
//
// Sending is its own route (./send), because it emails someone outside the
// company and deserves a verb nobody can reach by accident.

import { NextResponse } from "next/server"
import { suiteCaller } from "@/lib/suite-caller"
import {
  canApprove,
  canReject,
  parsePounds,
  penceToPounds,
  statusLabel,
  toPence,
  variationReference,
} from "@/lib/variations"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const FIELDS =
  "id, job_id, kind, number, description, labour_hours, materials, estimated_value, approved_value, " +
  "status, notes, photo_urls, photo_paths, created_at, approved_at, sent_at, sent_to_email, signed_at, " +
  "declined_at, decline_reason, invoiced_at, ai_detected, diary_entry_id, " +
  "raiser:users!variations_raised_by_fkey(name), approver:users!variations_approved_by_fkey(name), " +
  "jobs(id, name, contractor, client_id, clients(name, email))"

export async function GET() {
  const c = await suiteCaller("variations")
  if ("error" in c) return c.error
  const { service, companyId } = c

  const { data: rows, error } = (await service
    .from("variations")
    .select(FIELDS)
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(1000)) as { data: any[] | null; error: any }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const ids = (rows || []).map(r => r.id)
  const [shares, signatures, lines, hashes] = ids.length
    ? await Promise.all([
        service.from("variation_shares")
          .select("id, variation_id, sent_to_email, created_at, expires_at, revoked_at, first_viewed_at, view_count, document_sha256")
          .in("variation_id", ids).order("created_at", { ascending: false }),
        service.from("variation_signatures")
          .select("id, variation_id, decision, signer_name, signer_position, decline_reason, document_sha256, agreed_pence, decided_at")
          .in("variation_id", ids).order("decided_at", { ascending: false }),
        service.from("payment_application_lines")
          .select("variation_id, application_id, payment_applications(number, status)")
          .in("variation_id", ids),
        service.from("evidence_hashes")
          .select("entity_id, sha256, event, hashed_at")
          .eq("entity_type", "variations").in("entity_id", ids)
          .order("hashed_at", { ascending: false }),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }]

  // Latest of each, keyed by variation. Lists arrive newest first.
  const latest = (list: any[] | null, key = "variation_id") => {
    const m = new Map<string, any>()
    for (const r of list || []) if (!m.has(r[key])) m.set(r[key], r)
    return m
  }
  const shareBy = latest(shares.data)
  const sigBy = latest(signatures.data)
  const lineBy = latest(lines.data)
  const hashBy = latest(hashes.data, "entity_id")

  const variations = (rows || []).map((v: any) => {
    const share = shareBy.get(v.id)
    const sig = sigBy.get(v.id)
    const line = lineBy.get(v.id)
    const hash = hashBy.get(v.id)
    return {
      id: v.id,
      jobId: v.job_id,
      jobName: v.jobs?.name || "",
      contractor: v.jobs?.contractor || v.jobs?.clients?.name || null,
      contractorEmail: v.jobs?.clients?.email || null,
      kind: v.kind,
      reference: variationReference(v.kind, v.number),
      description: v.description,
      labourHours: v.labour_hours === null ? null : Number(v.labour_hours),
      materials: v.materials,
      estimatePence: toPence(v.estimated_value),
      pricePence: toPence(v.approved_value),
      status: v.status,
      statusLabel: statusLabel(v.status),
      notes: v.notes,
      photoUrls: v.photo_urls || [],
      raisedBy: v.raiser?.name || (v.ai_detected ? "Detected from the diary" : "Unknown"),
      raisedAt: v.created_at,
      approvedBy: v.approver?.name || null,
      approvedAt: v.approved_at,
      aiDetected: !!v.ai_detected,
      captureHash: hash ? { sha256: hash.sha256, event: hash.event, at: hash.hashed_at } : null,
      share: share
        ? {
            sentTo: share.sent_to_email,
            sentAt: share.created_at,
            expiresAt: share.expires_at,
            revoked: !!share.revoked_at,
            viewedAt: share.first_viewed_at,
            views: share.view_count,
            documentSha256: share.document_sha256,
          }
        : null,
      decision: sig
        ? {
            decision: sig.decision,
            signerName: sig.signer_name,
            signerPosition: sig.signer_position,
            reason: sig.decline_reason,
            documentSha256: sig.document_sha256,
            agreedPence: sig.agreed_pence === null ? null : Number(sig.agreed_pence),
            at: sig.decided_at,
          }
        : null,
      application: line
        ? { id: line.application_id, number: line.payment_applications?.number, status: line.payment_applications?.status }
        : null,
    }
  })

  return NextResponse.json({ variations })
}

export async function PATCH(request: Request) {
  const c = await suiteCaller("variations")
  if ("error" in c) return c.error
  const { service, companyId, ctx } = c

  const body = await request.json().catch(() => ({}))
  const id = typeof body.id === "string" ? body.id : ""
  const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 4000) : null
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })

  const { data: current } = await service
    .from("variations").select("id, status, company_id").eq("id", id).maybeSingle()
  if (!current || current.company_id !== companyId) {
    return NextResponse.json({ error: "Variation not found" }, { status: 404 })
  }

  const update: Record<string, any> = {}

  if (body.action === "approve") {
    if (!canApprove(current.status)) {
      return NextResponse.json({ error: `A variation that is ${statusLabel(current.status).toLowerCase()} cannot be re-priced` }, { status: 409 })
    }
    const pence = parsePounds(body.price)
    if (pence === undefined || pence === null) {
      return NextResponse.json({ error: "Price it first: an amount in pounds, like 1250 or 1250.50" }, { status: 400 })
    }
    update.approved_value = penceToPounds(pence)
    update.status = "approved"
    update.approved_at = new Date().toISOString()
    update.approved_by = ctx.userId
    // A fresh price after a decline is a fresh offer; the old refusal stays in
    // variation_signatures, where it is evidence.
    update.declined_at = null
    update.decline_reason = null
    if (notes !== null) update.notes = notes || null
  } else if (body.action === "reject") {
    if (!canReject(current.status)) {
      return NextResponse.json({ error: `A variation that is ${statusLabel(current.status).toLowerCase()} cannot be rejected` }, { status: 409 })
    }
    if (!notes) return NextResponse.json({ error: "Say why, so the person who raised it knows" }, { status: 400 })
    update.status = "rejected"
    update.notes = notes
  } else {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  }

  const { error } = await service
    .from("variations").update(update).eq("id", id).eq("company_id", companyId)
  if (error) return NextResponse.json({ error: error.message }, { status: 409 })

  return NextResponse.json({ ok: true })
}
