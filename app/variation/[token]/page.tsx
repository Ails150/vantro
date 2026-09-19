// app/variation/[token]/page.tsx
//
// What a main contractor sees when they open the link in the email.
//
// No login. Everything shown is the document that was hashed when the link was
// sent, rebuilt and re-hashed on every load: if it no longer matches, the page
// says so instead of offering a signature on something that has changed. The
// hash is printed at the foot, so the person signing can quote exactly what
// they signed.

import type { Metadata } from "next"
import { createServiceClient } from "@/lib/supabase/server"
import { formatPence, kindLabel } from "@/lib/variations"
import { hashShareToken, isWellFormedToken, loadVariationDocument } from "@/lib/variation-document"
import { formatDateTimeLong } from "@/lib/format-time"
import SignForm from "./SignForm"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Variation for signature",
  // A signing link must never end up in a search index.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
}

export default async function VariationSignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!isWellFormedToken(token)) return <Notice title="Link not valid" body="Check the link, or ask the sender for a new one." />

  const service = await createServiceClient()
  const { data: share } = await service
    .from("variation_shares")
    .select("id, variation_id, sent_to_email, document_sha256, expires_at, revoked_at, first_viewed_at, view_count")
    .eq("token_hash", hashShareToken(token))
    .maybeSingle()

  if (!share) return <Notice title="Link not valid" body="Check the link, or ask the sender for a new one." />
  if (share.revoked_at) {
    return <Notice title="Replaced by a newer version" body="The sender has issued an updated version of this. Use the link in their most recent email." />
  }
  if (new Date(share.expires_at) <= new Date()) {
    return <Notice title="Link expired" body="This link has expired. Ask the sender for a new one." />
  }

  const loaded = await loadVariationDocument(service, share.variation_id, share.sent_to_email)
  if (!loaded) return <Notice title="Link not valid" body="Ask the sender for a new one." />
  const { doc, sha256, row } = loaded

  // Best effort. A view is worth knowing about -- "they opened it on Tuesday"
  // ends a lot of arguments -- but not worth failing the page over.
  const now = new Date().toISOString()
  await service
    .from("variation_shares")
    .update({
      first_viewed_at: share.first_viewed_at || now,
      last_viewed_at: now,
      view_count: (share.view_count || 0) + 1,
    })
    .eq("id", share.id)
    .then(() => {}, () => {})

  const { data: decision } = await service
    .from("variation_signatures")
    .select("decision, signer_name, signer_position, decline_reason, decided_at, document_sha256, share_id")
    .eq("variation_id", doc.variation.id)
    .order("decided_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const changed = sha256 !== share.document_sha256
  const signedHere = decision && decision.share_id === share.id

  return (
    <main className="min-h-screen bg-surface px-4 py-8 text-ink">
      <div className="mx-auto max-w-2xl">
        <header className="mb-6 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-sm font-bold text-[#07100D]">V</div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{doc.company.name}</p>
            <p className="text-xs text-ink-muted">{kindLabel(doc.variation.kind)} for your signature</p>
          </div>
        </header>

        <section className="rounded-xl border border-line bg-canvas p-5 sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h1 className="text-xl font-semibold">{doc.variation.reference}</h1>
            <p className="num text-2xl font-semibold">{formatPence(doc.pricePence)}</p>
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            {doc.job.name}
            {doc.job.address ? ` · ${doc.job.address}` : ""}
          </p>

          <h2 className="mt-6 text-xs font-medium uppercase tracking-wide text-ink-subtle">What changed</h2>
          <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed">{doc.variation.description}</p>

          <dl className="mt-6 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            <Fact label="Labour" value={doc.variation.labourHours != null ? `${doc.variation.labourHours} hours` : "Not recorded"} />
            <Fact label="Recorded on site" value={`${formatDateTimeLong(doc.variation.raisedAt)}${doc.variation.raisedBy ? ` by ${doc.variation.raisedBy}` : ""}`} />
            <div className="sm:col-span-2">
              <Fact label="Materials" value={doc.variation.materials || "None recorded"} />
            </div>
          </dl>

          {row.photo_urls?.length > 0 && (
            <>
              <h2 className="mt-6 text-xs font-medium uppercase tracking-wide text-ink-subtle">
                Photographs ({row.photo_urls.length})
              </h2>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {row.photo_urls.map((url: string, i: number) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer noopener" className="block overflow-hidden rounded-lg border border-line">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={`Photograph ${i + 1}`} className="aspect-square w-full object-cover" />
                  </a>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="mt-4 rounded-xl border border-line bg-canvas p-5 sm:p-6">
          {changed ? (
            <p className="text-sm text-danger">
              This {kindLabel(doc.variation.kind).toLowerCase()} has changed since it was sent to you, so it cannot be
              signed from this link. Ask {doc.company.name} for the current version.
            </p>
          ) : decision && (signedHere || row.status !== "sent") ? (
            <Decided decision={decision} />
          ) : row.status !== "sent" ? (
            <p className="text-sm text-ink-muted">This is not waiting for a signature any more.</p>
          ) : (
            <SignForm token={token} amount={formatPence(doc.pricePence)} reference={doc.variation.reference} />
          )}
        </section>

        <footer className="mt-6 space-y-1 break-all text-[11px] leading-relaxed text-ink-subtle">
          <p>
            Document fingerprint (SHA-256): <span className="font-mono">{sha256}</span>
          </p>
          <p>
            Site record fingerprint: <span className="font-mono">{doc.variation.captureSha256 || "not available"}</span>
          </p>
          <p>
            Your decision is recorded against this fingerprint with the time and your name. Sent to {doc.sentTo}.
          </p>
        </footer>
      </div>
    </main>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap">{value}</dd>
    </div>
  )
}

function Decided({ decision }: { decision: any }) {
  const signed = decision.decision === "signed"
  return (
    <div>
      <p className={`text-sm font-medium ${signed ? "text-ok" : "text-warn"}`}>
        {signed ? "Signed" : "Declined"} by {decision.signer_name}
        {decision.signer_position ? `, ${decision.signer_position}` : ""}
      </p>
      <p className="mt-1 text-sm text-ink-muted">{formatDateTimeLong(decision.decided_at)}</p>
      {!signed && decision.decline_reason && (
        <p className="mt-2 whitespace-pre-wrap text-sm">{decision.decline_reason}</p>
      )}
    </div>
  )
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4 text-ink">
      <div className="max-w-md rounded-xl border border-line bg-canvas p-8 text-center">
        <div className="mx-auto mb-5 flex h-10 w-10 items-center justify-center rounded-lg bg-accent font-bold text-[#07100D]">V</div>
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-ink-muted">{body}</p>
      </div>
    </main>
  )
}
