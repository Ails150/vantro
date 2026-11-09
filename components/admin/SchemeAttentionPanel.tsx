"use client"
import { useCallback, useEffect, useState } from "react"

const LABEL: Record<string, string> = { certass: "Certass", fensa: "FENSA" }

const longDate = (d: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${d}T12:00:00Z`))

/**
 * Registrations that need someone, on Today. It has its own panel rather than
 * a line in the action list because each one carries a reason and a Retry.
 */
export default function SchemeAttentionPanel() {
  const [items, setItems] = useState<any[]>([])
  const [loadFailed, setLoadFailed] = useState(false)

  const load = useCallback(() => {
    fetch("/api/admin/schemes/jobs")
      .then(async r => {
        if (r.status === 403) return
        if (!r.ok) throw new Error(String(r.status))
        const d = await r.json()
        setItems(d.items || [])
        setLoadFailed(false)
      })
      .catch(() => setLoadFailed(true))
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 120000)
    return () => clearInterval(t)
  }, [load])

  if (loadFailed) {
    return (
      <div className="mb-4 rounded-lg border border-line bg-surface p-4">
        <p className="text-sm text-danger">Could not check scheme registrations. Refresh to try again.</p>
      </div>
    )
  }
  if (items.length === 0) return null

  return (
    <div className="mb-4 rounded-lg border border-line bg-surface p-4">
      <h3 className="text-sm font-bold text-ink">
        {items.length === 1 ? "Scheme registration needs you" : `${items.length} scheme registrations need you`}
      </h3>
      <div className="mt-3 space-y-3">
        {items.map(item => <Row key={item.jobId} item={item} onDone={load} />)}
      </div>
    </div>
  )
}

function Row({ item, onDone }: { item: any; onDone: () => void }) {
  const [checking, setChecking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function retry(confirmedNotRegistered: boolean) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/schemes/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: item.jobId, confirmedNotRegistered }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) setError(body.error || `Retry failed (${res.status})`)
      setChecking(false)
      onDone()
    } catch (e: any) {
      setError(e?.message || "Retry failed")
    }
    setBusy(false)
  }

  const button = "shrink-0 bg-canvas border border-line-strong hover:bg-surface-hover text-ink rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50"

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">
          {item.jobName}{item.scheme ? ` (${LABEL[item.scheme] || item.scheme})` : ""}
        </p>
        <p className="text-xs text-ink-muted mt-0.5">{item.reason}</p>
        {item.deadline && <p className="text-xs text-ink-subtle mt-0.5">Register by {longDate(item.deadline)}</p>}
        {error && <p className="text-xs text-danger mt-1">{error}</p>}
      </div>
      {!item.needsPortalCheck ? (
        <button type="button" disabled={busy} onClick={() => retry(false)} className={button}>
          {busy ? "Retrying..." : "Retry"}
        </button>
      ) : checking ? (
        <button type="button" disabled={busy} onClick={() => retry(true)} className={button}>
          {busy ? "Retrying..." : "It is not on the portal, retry"}
        </button>
      ) : (
        <button type="button" onClick={() => setChecking(true)} className={button}>Retry</button>
      )}
    </div>
  )
}
