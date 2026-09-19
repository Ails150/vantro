"use client"
import { useCallback, useEffect, useMemo, useState } from "react"
import { PageTransition, PageHeader } from "@/components/ui/Page"
import { Button } from "@/components/ui/Button"
import {
  canApprove,
  canReject,
  canSend,
  formatPence,
  kindLabel,
  sumPence,
} from "@/lib/variations"

/**
 * Variations and dayworks: raised on site, priced here, signed by the main
 * contractor from a link, and carried onto a payment application.
 *
 * Ordered as a queue, newest first within each filter. The default filter is
 * everything still in motion -- needs pricing, awaiting signature, signed but
 * not yet applied for -- because those are the three places money goes
 * missing. Rejected, declined and applied-for ones are a click away rather
 * than mixed in.
 */

type Variation = {
  id: string
  jobId: string
  jobName: string
  contractor: string | null
  contractorEmail: string | null
  kind: string
  reference: string
  description: string
  labourHours: number | null
  materials: string | null
  estimatePence: number | null
  pricePence: number | null
  status: string
  statusLabel: string
  notes: string | null
  photoUrls: string[]
  raisedBy: string
  raisedAt: string
  approvedBy: string | null
  approvedAt: string | null
  aiDetected: boolean
  captureHash: { sha256: string; event: string; at: string } | null
  share: null | {
    sentTo: string
    sentAt: string
    expiresAt: string
    revoked: boolean
    viewedAt: string | null
    views: number
    documentSha256: string
  }
  decision: null | {
    decision: "signed" | "declined"
    signerName: string
    signerPosition: string | null
    reason: string | null
    documentSha256: string
    agreedPence: number | null
    at: string
  }
  application: null | { id: string; number: number; status: string }
}

type Application = {
  id: string
  jobId: string
  jobName: string
  contractor: string | null
  number: number
  status: "draft" | "submitted"
  createdAt: string
  submittedAt: string | null
  lines: Array<{ id: string; source: string; description: string; amountPence: number }>
  totalPence: number
}

type Filter = "open" | "pending" | "approved" | "sent" | "signed" | "invoiced" | "closed" | "all"

const FILTERS: Array<{ id: Filter; label: string; match: (v: Variation) => boolean }> = [
  { id: "open", label: "In progress", match: v => ["pending", "approved", "sent", "signed"].includes(v.status) },
  { id: "pending", label: "Needs pricing", match: v => v.status === "pending" },
  { id: "approved", label: "Approved, not sent", match: v => v.status === "approved" },
  { id: "sent", label: "Awaiting signature", match: v => v.status === "sent" },
  { id: "signed", label: "Signed", match: v => v.status === "signed" },
  { id: "invoiced", label: "On an application", match: v => v.status === "invoiced" },
  { id: "closed", label: "Rejected or declined", match: v => v.status === "rejected" || v.status === "declined" },
  { id: "all", label: "All", match: () => true },
]

export default function VariationsTab() {
  const [view, setView] = useState<"variations" | "applications">("variations")
  const [variations, setVariations] = useState<Variation[]>([])
  const [applications, setApplications] = useState<Application[]>([])
  const [filter, setFilter] = useState<Filter>("open")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [vr, ar] = await Promise.all([
        fetch("/api/admin/variations"),
        fetch("/api/admin/payment-applications"),
      ])
      const vb = await vr.json().catch(() => ({}))
      const ab = await ar.json().catch(() => ({}))
      if (!vr.ok) { setError(vb.error || `Could not load variations (${vr.status})`); return }
      setVariations(vb.variations || [])
      if (ar.ok) setApplications(ab.applications || [])
    } catch (e: any) {
      setError(e?.message || "Could not load variations")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const counts = useMemo(() => {
    const pending = variations.filter(v => v.status === "pending")
    const awaiting = variations.filter(v => v.status === "sent")
    const signed = variations.filter(v => v.status === "signed")
    return {
      pending: pending.length,
      awaiting: awaiting.length,
      awaitingPence: sumPence(awaiting.map(v => v.pricePence)),
      signedPence: sumPence(signed.map(v => v.decision?.agreedPence ?? v.pricePence)),
      signed: signed.length,
    }
  }, [variations])

  const active = FILTERS.find(f => f.id === filter)!
  const visible = variations.filter(active.match)

  return (
    <PageTransition>
      <PageHeader
        title="Variations"
        description="Raised on site with photos and hours, priced here, signed by the main contractor from a link, then added to a payment application."
      />

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Figure label="Needs pricing" value={String(counts.pending)} tone={counts.pending > 0 ? "warning" : undefined} />
        <Figure label="Awaiting signature" value={String(counts.awaiting)} sub={counts.awaiting ? formatPence(counts.awaitingPence) : undefined} />
        <Figure label="Signed, not applied for" value={formatPence(counts.signedPence)} sub={`${counts.signed} signed`} tone={counts.signed > 0 ? "warning" : undefined} />
        <Figure label="Payment applications" value={String(applications.length)} sub={`${applications.filter(a => a.status === "draft").length} draft`} />
      </div>

      <div className="mb-4 flex gap-2 border-b border-line">
        {(["variations", "applications"] as const).map(v => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${view === v ? "border-accent text-ink" : "border-transparent text-ink-muted hover:text-ink"}`}
          >
            {v === "variations" ? "Variations and dayworks" : "Payment applications"}
          </button>
        ))}
      </div>

      {loading && <div className="py-12 text-center text-ink-subtle">Loading…</div>}
      {error && <div className="py-4 text-sm text-danger">{error}</div>}

      {!loading && !error && view === "variations" && (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {FILTERS.map(f => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`rounded-full px-3 py-1 text-xs ${filter === f.id ? "bg-ink text-canvas" : "border border-line text-ink-muted hover:text-ink"}`}
              >
                {f.label} <span className="num opacity-70">{variations.filter(f.match).length}</span>
              </button>
            ))}
          </div>
          {visible.length === 0 ? (
            <div className="py-12 text-center text-sm text-ink-subtle">
              {variations.length === 0
                ? "Nothing raised yet. Workers raise variations and dayworks from the job screen in the app."
                : "Nothing in this list."}
            </div>
          ) : (
            <div className="space-y-4">
              {visible.map(v => <VariationCard key={v.id} v={v} onChanged={load} />)}
            </div>
          )}
        </>
      )}

      {!loading && !error && view === "applications" && (
        <Applications applications={applications} onChanged={load} />
      )}
    </PageTransition>
  )
}

function VariationCard({ v, onChanged }: { v: Variation; onChanged: () => void }) {
  const [price, setPrice] = useState(
    v.pricePence != null ? (v.pricePence / 100).toFixed(2) : v.estimatePence != null ? (v.estimatePence / 100).toFixed(2) : "",
  )
  const [notes, setNotes] = useState(v.notes || "")
  const [email, setEmail] = useState(v.share?.sentTo || v.contractorEmail || "")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState(false)

  async function call(url: string, method: string, body: any) {
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setErr(data.error || `Failed (${res.status})`); return null }
      return data
    } catch (e: any) {
      setErr(e?.message || "Failed")
      return null
    } finally {
      setBusy(false)
    }
  }

  async function approve() {
    const r = await call("/api/admin/variations", "PATCH", { id: v.id, action: "approve", price, notes })
    if (r) onChanged()
  }
  async function reject() {
    const r = await call("/api/admin/variations", "PATCH", { id: v.id, action: "reject", notes })
    if (r) { setRejecting(false); onChanged() }
  }
  async function send() {
    const r = await call("/api/admin/variations/send", "POST", { id: v.id, email })
    if (r) {
      setLink(r.url)
      if (!r.emailed) setErr(`Saved, but the email did not go (${r.emailError || "unknown"}). Copy the link below and send it yourself.`)
      onChanged()
    }
  }
  async function addToApplication() {
    const r = await call("/api/admin/payment-applications", "POST", { jobId: v.jobId })
    if (r) onChanged()
  }

  const closed = v.status === "rejected" || v.status === "declined" || v.status === "invoiced"

  return (
    <div className={`rounded-lg border p-4 ${v.status === "pending" ? "border-warn/50" : "border-line"} bg-surface ${v.status === "rejected" ? "opacity-70" : ""}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-ink">
            {v.reference} <span className="font-normal text-ink-subtle">· {kindLabel(v.kind)}</span>
          </h3>
          <p className="mt-0.5 text-xs text-ink-subtle">
            {v.jobName}
            {v.contractor ? ` · ${v.contractor}` : ""} · raised by {v.raisedBy} {shortDate(v.raisedAt)}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${badgeTone(v.status)}`}>{v.statusLabel}</span>
      </div>

      <p className="mt-3 whitespace-pre-wrap text-sm text-ink">{v.description}</p>

      <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <Fact label="Hours" value={v.labourHours != null ? String(v.labourHours) : "—"} />
        <Fact label="Worker's estimate" value={v.estimatePence != null ? formatPence(v.estimatePence) : "—"} />
        {v.pricePence != null && <Fact label="Price" value={formatPence(v.pricePence)} strong />}
        {v.materials && <Fact label="Materials" value={v.materials} />}
      </div>

      {v.photoUrls.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {v.photoUrls.map((u, i) => (
            <a key={u} href={u} target="_blank" rel="noreferrer noopener">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt={`Photo ${i + 1}`} className="h-20 w-20 rounded-md border border-line object-cover" />
            </a>
          ))}
        </div>
      )}

      {/* Where it is. Each line is a fact with a time on it, because this is the
          part somebody reads out on the phone to a quantity surveyor. */}
      <div className="mt-3 space-y-1 text-xs text-ink-muted">
        {v.approvedAt && <p>Priced and approved {v.approvedBy ? `by ${v.approvedBy} ` : ""}{shortDate(v.approvedAt)}</p>}
        {v.share && (
          <p>
            Sent to {v.share.sentTo} {shortDate(v.share.sentAt)}
            {v.share.viewedAt ? ` · opened ${shortDate(v.share.viewedAt)} (${v.share.views}×)` : " · not opened yet"}
          </p>
        )}
        {v.decision && (
          <p className={v.decision.decision === "signed" ? "text-ok" : "text-warn"}>
            {v.decision.decision === "signed" ? "Signed" : "Declined"} by {v.decision.signerName}
            {v.decision.signerPosition ? ` (${v.decision.signerPosition})` : ""} {shortDate(v.decision.at)}
            {v.decision.agreedPence != null ? ` at ${formatPence(v.decision.agreedPence)}` : ""}
            {v.decision.reason ? `: ${v.decision.reason}` : ""}
          </p>
        )}
        {v.application && <p>On payment application {v.application.number} ({v.application.status})</p>}
        {v.notes && v.status === "rejected" && <p>Rejected: {v.notes}</p>}
        {v.captureHash && (
          <p className="font-mono text-[11px] text-ink-subtle" title={v.captureHash.sha256}>
            Site record SHA-256 {v.captureHash.sha256.slice(0, 16)}… ({v.captureHash.event})
            {v.decision ? ` · signed document ${v.decision.documentSha256.slice(0, 16)}…` : ""}
          </p>
        )}
      </div>

      {!closed && (
        <div className="mt-4 space-y-3 border-t border-line pt-3">
          {canApprove(v.status) && v.status !== "sent" && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs text-ink-subtle">
                Price (£)
                <input
                  value={price}
                  onChange={e => setPrice(e.target.value)}
                  inputMode="decimal"
                  className="mt-1 block w-32 rounded-md border border-line-strong bg-canvas px-2 py-1.5 text-sm text-ink"
                />
              </label>
              <label className="min-w-[12rem] flex-1 text-xs text-ink-subtle">
                Note (optional)
                <input
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-line-strong bg-canvas px-2 py-1.5 text-sm text-ink"
                />
              </label>
              <Button variant={v.status === "approved" ? "secondary" : "primary"} size="sm" disabled={busy} onClick={approve}>
                {v.status === "approved" ? "Update price" : "Approve"}
              </Button>
              {canReject(v.status) && (
                rejecting ? (
                  <Button tone="danger" size="sm" disabled={busy} onClick={reject}>Confirm reject</Button>
                ) : (
                  <Button variant="ghost" tone="danger" size="sm" disabled={busy} onClick={() => setRejecting(true)}>Reject</Button>
                )
              )}
            </div>
          )}
          {rejecting && <p className="text-xs text-ink-subtle">Put the reason in the note, then confirm.</p>}

          {canSend(v.status) && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-[14rem] flex-1 text-xs text-ink-subtle">
                Main contractor email
                <input
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  type="email"
                  placeholder="qs@maincontractor.co.uk"
                  className="mt-1 block w-full rounded-md border border-line-strong bg-canvas px-2 py-1.5 text-sm text-ink"
                />
              </label>
              <Button variant="primary" size="sm" disabled={busy || !email} onClick={send}>
                {v.status === "sent" ? "Resend link" : "Send for signature"}
              </Button>
            </div>
          )}

          {v.status === "signed" && (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" size="sm" disabled={busy} onClick={addToApplication}>
                Add to payment application
              </Button>
              <span className="text-xs text-ink-subtle">Adds everything signed on {v.jobName}, plus approved expenses on it.</span>
            </div>
          )}
        </div>
      )}

      {link && (
        <p className="mt-2 break-all text-xs text-ink-muted">
          Link: <a className="underline" href={link} target="_blank" rel="noreferrer noopener">{link}</a>
        </p>
      )}
      {err && <p className="mt-2 text-sm text-danger">{err}</p>}
    </div>
  )
}

function Applications({ applications, onChanged }: { applications: Application[]; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function call(key: string, url: string, init: RequestInit) {
    setBusy(key)
    setErr(null)
    try {
      const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) setErr(data.error || `Failed (${res.status})`)
      else onChanged()
    } catch (e: any) {
      setErr(e?.message || "Failed")
    }
    setBusy(null)
  }

  if (applications.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-ink-subtle">
        No payment applications yet. Once a variation is signed, “Add to payment application” opens one for its job.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {err && <p className="text-sm text-danger">{err}</p>}
      {applications.map(a => (
        <div key={a.id} className="rounded-lg border border-line bg-surface p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 className="truncate font-semibold text-ink">
                Application {a.number} <span className="font-normal text-ink-subtle">· {a.jobName}</span>
              </h3>
              <p className="mt-0.5 text-xs text-ink-subtle">
                {a.contractor ? `${a.contractor} · ` : ""}opened {shortDate(a.createdAt)}
                {a.submittedAt ? ` · submitted ${shortDate(a.submittedAt)}` : ""}
              </p>
            </div>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${a.status === "draft" ? "bg-warn-wash text-warn" : "bg-ok-wash text-ok"}`}>
              {a.status === "draft" ? "Draft" : "Submitted"}
            </span>
          </div>

          <table className="mt-3 w-full text-sm">
            <tbody>
              {a.lines.map(l => (
                <tr key={l.id} className="border-t border-line">
                  <td className="py-2 pr-3 text-ink">{l.description}</td>
                  <td className="num whitespace-nowrap py-2 text-right text-ink">{formatPence(l.amountPence)}</td>
                  {a.status === "draft" && (
                    <td className="w-16 py-2 text-right">
                      <button
                        className="text-xs text-ink-subtle underline hover:text-danger"
                        disabled={busy === l.id}
                        onClick={() => call(l.id, `/api/admin/payment-applications?lineId=${l.id}`, { method: "DELETE" })}
                      >
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              <tr className="border-t border-line-strong">
                <td className="py-2 pr-3 font-semibold text-ink">Total</td>
                <td className="num whitespace-nowrap py-2 text-right font-semibold text-ink">{formatPence(a.totalPence)}</td>
                {a.status === "draft" && <td />}
              </tr>
            </tbody>
          </table>

          {a.status === "draft" && (
            <div className="mt-3 flex gap-2">
              <Button
                variant="primary"
                size="sm"
                disabled={busy === a.id || a.lines.length === 0}
                onClick={() => call(a.id, "/api/admin/payment-applications", { method: "PATCH", body: JSON.stringify({ id: a.id, action: "submit" }) })}
              >
                Mark submitted
              </Button>
              <span className="self-center text-xs text-ink-subtle">Once submitted, its lines are fixed.</span>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function Fact({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-xs uppercase tracking-wide text-ink-subtle">{label}</p>
      <p className={`whitespace-pre-wrap ${strong ? "num font-bold text-ink" : "text-ink"}`}>{value}</p>
    </div>
  )
}

function Figure({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "warning" }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="text-xs uppercase tracking-wide text-ink-subtle">{label}</p>
      <p className={`num mt-1 text-2xl font-bold ${tone === "warning" ? "text-warn" : "text-ink"}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-subtle">{sub}</p>}
    </div>
  )
}

function badgeTone(status: string): string {
  switch (status) {
    case "pending": return "bg-warn-wash text-warn"
    case "sent": return "bg-accent-wash text-accent-ink"
    case "signed": return "bg-ok-wash text-ok"
    case "declined": return "bg-danger/15 text-danger"
    default: return "bg-surface-hover text-ink-subtle"
  }
}

function shortDate(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })
}
