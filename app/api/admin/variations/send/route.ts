// app/api/admin/variations/send/route.ts
//
// POST { id, email? }  send an approved variation to the main contractor.
//
// One click. The address comes from the job's client unless the admin typed a
// different one; the link is emailed from here, and returned as well, so a
// failed email is a link to paste rather than a dead end.
//
// What happens, in order:
//   1. Any earlier link for this variation is revoked. Only the latest offer
//      can be signed; an old link to a superseded price must not work.
//   2. The document is assembled and hashed. That hash is stored on the new
//      link and is what the signature will be checked against.
//   3. The variation moves to sent, which freezes it (the migration's guard).
//   4. The email goes.

import { NextResponse } from "next/server"
import { suiteCaller } from "@/lib/suite-caller"
import {
  SHARE_EXPIRY_DAYS,
  canSend,
  formatPence,
  looksLikeEmail,
  statusLabel,
} from "@/lib/variations"
import { hashShareToken, loadVariationDocument, newShareToken } from "@/lib/variation-document"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function baseUrl(req: Request): string {
  const host = req.headers.get("host")
  const proto = req.headers.get("x-forwarded-proto") || "https"
  return host ? `${proto}://${host}` : "https://app.getvantro.com"
}

export async function POST(request: Request) {
  const c = await suiteCaller("variations")
  if ("error" in c) return c.error
  const { service, companyId, ctx, company } = c

  const body = await request.json().catch(() => ({}))
  const id = typeof body.id === "string" ? body.id : ""
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })

  const { data: v } = await service
    .from("variations")
    .select("id, company_id, status, approved_value, jobs(name, clients(name, email))")
    .eq("id", id)
    .maybeSingle()
  if (!v || v.company_id !== companyId) {
    return NextResponse.json({ error: "Variation not found" }, { status: 404 })
  }
  if (!canSend(v.status)) {
    return NextResponse.json(
      { error: `Only an approved variation can be sent. This one is ${statusLabel(v.status).toLowerCase()}.` },
      { status: 409 },
    )
  }

  const typed = typeof body.email === "string" ? body.email.trim() : ""
  const email = (typed || v.jobs?.clients?.email || "").trim().toLowerCase()
  if (!looksLikeEmail(email)) {
    return NextResponse.json(
      { error: "This job has no main contractor email. Enter the address to send it to.", needsEmail: true },
      { status: 400 },
    )
  }

  const loaded = await loadVariationDocument(service, id, email)
  if (!loaded) return NextResponse.json({ error: "Price it before sending" }, { status: 409 })
  const { doc, sha256 } = loaded

  const now = new Date()
  await service
    .from("variation_shares")
    .update({ revoked_at: now.toISOString() })
    .eq("variation_id", id)
    .is("revoked_at", null)

  const token = newShareToken()
  const { error: shareErr } = await service.from("variation_shares").insert({
    company_id: companyId,
    variation_id: id,
    token_hash: hashShareToken(token),
    sent_to_email: email,
    document_sha256: sha256,
    created_by: ctx.userId,
    expires_at: new Date(now.getTime() + SHARE_EXPIRY_DAYS * 86400000).toISOString(),
  })
  if (shareErr) return NextResponse.json({ error: shareErr.message }, { status: 500 })

  const { error: updErr } = await service
    .from("variations")
    .update({ status: "sent", sent_at: now.toISOString(), sent_by: ctx.userId, sent_to_email: email })
    .eq("id", id)
    .eq("company_id", companyId)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 409 })

  const url = `${baseUrl(request)}/variation/${token}`
  const emailed = await emailLink({
    to: email,
    replyTo: ctx.email,
    companyName: company.name,
    jobName: doc.job.name,
    reference: doc.variation.reference,
    kind: doc.variation.kind,
    price: formatPence(doc.pricePence),
    url,
  })

  console.log(`[variations] ${doc.variation.reference} sent to main contractor company=${companyId} emailed=${emailed.ok}`)
  return NextResponse.json({
    ok: true,
    url,
    sentTo: email,
    documentSha256: sha256,
    emailed: emailed.ok,
    emailError: emailed.ok ? undefined : emailed.why,
  })
}

async function emailLink(a: {
  to: string
  replyTo: string | null
  companyName: string
  jobName: string
  reference: string
  kind: string
  price: string
  url: string
}): Promise<{ ok: true } | { ok: false; why: string }> {
  const key = process.env.RESEND_API_KEY
  if (!key) return { ok: false, why: "RESEND_API_KEY is not set" }
  const what = a.kind === "daywork" ? "daywork sheet" : "variation"
  const esc = (s: string) => s.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`)
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Vantro <noreply@getvantro.com>",
        to: [a.to],
        ...(a.replyTo ? { reply_to: a.replyTo } : {}),
        subject: `${a.companyName}: ${what} ${a.reference} on ${a.jobName} for your signature`,
        html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px">
          <h2 style="color:#0A1A14;font-size:1.3rem;margin-bottom:12px">${esc(a.reference)} &middot; ${esc(a.jobName)}</h2>
          <p style="color:#4A6158;line-height:1.6">
            ${esc(a.companyName)} has sent you a ${what} for ${esc(a.price)} to review and sign.
            It includes the description, photographs and hours recorded on site.
          </p>
          <a href="${a.url}" style="display:inline-block;background:#00C896;color:#07100D;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;margin:16px 0">Review and sign</a>
          <p style="color:#888;font-size:12px;line-height:1.5">
            The link is personal to you and works for 30 days. You can also decline it with a reason.
            Replies to this email go to ${esc(a.companyName)}.
          </p>
        </div>`,
      }),
    })
    if (!res.ok) return { ok: false, why: `resend ${res.status}: ${(await res.text()).slice(0, 200)}` }
    return { ok: true }
  } catch (e: any) {
    return { ok: false, why: e?.message || "send threw" }
  }
}
