// app/api/variations/sign/route.ts
//
// POST { token, decision: "signed" | "declined", name, position?, strokes?, reason? }
//
// The one route in this feature with no login. It is reached from a link
// emailed to a main contractor, who has no Vantro account and should not need
// one to agree to a variation. The token IS the authority, so it is treated
// like a password: 256 bits, stored only as a hash, single-purpose (one
// variation), revoked when a newer offer supersedes it, and expired after
// thirty days.
//
// The signature is sent as stroke coordinates, not as an image. The server
// draws the SVG itself from numbers it has range-checked. An SVG accepted from
// a stranger's browser is markup, and markup that is later rendered into an
// admin page and an audit pack is a stored-XSS vector with extra steps; a list
// of numbers is not.
//
// Everything that makes the decision binding happens in the database, in one
// transaction (variation_apply_decision, 20260919100000): the variation must
// still be out for signature, the link must still be live, and the document
// hash recomputed here must equal the hash fixed when the link was sent. If
// the price or the evidence changed in between, nothing is signed.

import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { LIMITS, getClientIp, rateLimit, rateLimitedResponse } from "@/lib/rate-limit"
import { hashShareToken, isWellFormedToken, loadVariationDocument, strokesToSvg } from "@/lib/variation-document"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const ip = getClientIp(request)
  const limit = await rateLimit(`variation-sign:ip:${ip}`, LIMITS.variationSign.max, LIMITS.variationSign.windowSeconds)
  if (!limit.allowed) return rateLimitedResponse(limit, LIMITS.variationSign.max)

  const body = await request.json().catch(() => ({}))
  const token = body.token
  const decision = body.decision === "declined" ? "declined" : body.decision === "signed" ? "signed" : null
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 200) : ""
  const position = typeof body.position === "string" ? body.position.trim().slice(0, 200) : ""
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 4000) : ""

  // One refusal for every kind of bad link, so the response does not tell a
  // prober which tokens exist.
  const notValid = () => NextResponse.json({ error: "This link is not valid any more. Ask the sender for a new one." }, { status: 404 })
  if (!isWellFormedToken(token)) return notValid()
  if (!decision) return NextResponse.json({ error: "Sign or decline" }, { status: 400 })
  if (name.length < 2) return NextResponse.json({ error: "Type your full name" }, { status: 400 })

  let signatureSvg: string | null = null
  if (decision === "signed") {
    signatureSvg = strokesToSvg(body.strokes)
    if (!signatureSvg) return NextResponse.json({ error: "Draw your signature in the box" }, { status: 400 })
  } else if (!reason) {
    return NextResponse.json({ error: "Say why you are declining, so it can be put right" }, { status: 400 })
  }

  const service = await createServiceClient()
  const { data: share } = await service
    .from("variation_shares")
    .select("id, company_id, variation_id, sent_to_email, document_sha256, expires_at, revoked_at")
    .eq("token_hash", hashShareToken(token))
    .maybeSingle()
  if (!share || share.revoked_at || new Date(share.expires_at) <= new Date()) return notValid()

  // Recompute what the link shows now. If it no longer hashes to what was
  // sent, the page they are looking at is not the offer that was made.
  const loaded = await loadVariationDocument(service, share.variation_id, share.sent_to_email)
  if (!loaded) return notValid()
  if (loaded.sha256 !== share.document_sha256) {
    return NextResponse.json(
      { error: "This variation has changed since it was sent to you. Ask the sender for the current version." },
      { status: 409 },
    )
  }
  if (loaded.row.status !== "sent") {
    const already = loaded.row.status === "signed" || loaded.row.status === "invoiced" ? "signed" : loaded.row.status
    return NextResponse.json({ error: `This has already been ${already}.` }, { status: 409 })
  }

  const { data: sig, error } = await service
    .from("variation_signatures")
    .insert({
      company_id: share.company_id,
      variation_id: share.variation_id,
      share_id: share.id,
      decision,
      signer_name: name,
      signer_position: position || null,
      signature_svg: signatureSvg,
      decline_reason: decision === "declined" ? reason : null,
      document_sha256: loaded.sha256,
      agreed_pence: decision === "signed" ? loaded.doc.pricePence : null,
      ip_address: ip === "unknown" ? null : ip,
      user_agent: (request.headers.get("user-agent") || "").slice(0, 400) || null,
    })
    .select("id, decided_at")
    .single()

  if (error || !sig) {
    // The trigger's refusals are the ones a person can act on; anything else
    // is ours to look at.
    console.error("[variations] decision refused", share.variation_id, error?.message)
    const msg = error?.message || ""
    if (/already|not awaiting|unique|duplicate/i.test(msg)) {
      return NextResponse.json({ error: "This has already been answered." }, { status: 409 })
    }
    if (/no longer valid/i.test(msg)) return notValid()
    if (/not the document sent/i.test(msg)) {
      return NextResponse.json({ error: "This variation has changed since it was sent to you." }, { status: 409 })
    }
    return NextResponse.json({ error: "Could not record that. Please try again." }, { status: 500 })
  }

  // The office finds out now, not when someone next opens the tab.
  const ref = loaded.doc.variation.reference
  const { error: alertErr } = await service.from("alerts").insert({
    company_id: share.company_id,
    job_id: loaded.doc.job.id,
    user_id: null,
    alert_type: "issue",
    message:
      decision === "signed"
        ? `${ref} on ${loaded.doc.job.name} was signed by ${name}${position ? ` (${position})` : ""}.`
        : `${ref} on ${loaded.doc.job.name} was declined by ${name}: ${reason.slice(0, 140)}`,
    status: "open",
    urgency: decision === "signed" ? 1 : 2,
    is_read: false,
  })
  if (alertErr) console.error("[variations] decision alert insert failed", alertErr.message)

  console.log(`[variations] ${ref} ${decision} via link share=${share.id}`)
  return NextResponse.json({
    ok: true,
    decision,
    reference: ref,
    decidedAt: sig.decided_at,
    documentSha256: loaded.sha256,
  })
}
