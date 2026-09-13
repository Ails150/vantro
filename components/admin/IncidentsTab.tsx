"use client"
import { useState, useEffect, useCallback } from "react"
import { PageTransition, PageHeader, Section } from "@/components/ui/Page"

/**
 * Incidents: near misses, injuries and hazards.
 *
 * Open first and loud, because an unclosed incident is a live problem. Closing
 * requires a note and the form says why: the note is the only part of a closure
 * anyone reads afterwards, and "closed" with nothing beside it is indexed as
 * having done nothing.
 *
 * The worker's account is shown as written and is not editable here. That is
 * enforced in the database as well (incidents_report_immutable) -- this screen
 * simply never offers it.
 */

type Incident = {
  id: string
  jobName: string | null
  kind: "near_miss" | "injury" | "hazard"
  description: string
  photoUrls: string[]
  occurredAt: string
  reportedAt: string
  reportedBy: string
  hasLocation: boolean
  status: "open" | "acknowledged" | "closed"
  acknowledgedAt: string | null
  acknowledgedBy: string | null
  closedAt: string | null
  closedBy: string | null
  closureNotes: string | null
}

const KIND_LABEL: Record<string, string> = {
  near_miss: "Near miss",
  injury: "Injury",
  hazard: "Hazard",
}

function fmt(ts: string | null) {
  if (!ts) return "—"
  return new Date(ts).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  })
}

export default function IncidentsTab() {
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [showClosed, setShowClosed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [closing, setClosing] = useState<string | null>(null)
  const [notes, setNotes] = useState("")
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/incidents?status=${showClosed ? "all" : "open"}`)
      const body = await res.json()
      if (!res.ok) setError(body.error || `Could not load (${res.status})`)
      else setIncidents(body.incidents || [])
    } catch (e: any) {
      setError(e?.message || "Could not load")
    }
    setLoading(false)
  }, [showClosed])

  useEffect(() => { load() }, [load])

  async function act(id: string, action: "acknowledge" | "close", closureNotes?: string) {
    setBusy(true)
    setActionError(null)
    const res = await fetch("/api/admin/incidents", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action, closureNotes }),
    })
    const body = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setActionError(body.error || `Failed (${res.status})`); return }
    setClosing(null)
    setNotes("")
    load()
  }

  const inp =
    "w-full rounded-md border border-line-strong bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-ink/20"

  const openCount = incidents.filter(i => i.status !== "closed").length

  return (
    <PageTransition>
      <PageHeader
        title="Incidents"
        description="Near misses, injuries and hazards reported from site. Anything not closed stays on Today."
      />

      <div className="flex items-center gap-4 mb-5">
        <button
          onClick={() => setShowClosed(v => !v)}
          className="text-sm text-ink-subtle underline hover:text-ink"
        >
          {showClosed ? "Show open only" : "Include closed"}
        </button>
        {openCount > 0 && (
          <span className="text-sm font-medium text-danger">
            {openCount} still open
          </span>
        )}
      </div>

      {loading && <div className="text-center py-12 text-ink-subtle">Loading…</div>}
      {error && <div className="text-sm text-danger py-4">{error}</div>}
      {actionError && <div className="text-sm text-danger py-2">{actionError}</div>}

      {!loading && !error && incidents.length === 0 && (
        <div className="text-center py-12 text-ink-subtle text-sm">
          {showClosed ? "No incidents recorded." : "Nothing open. Reported incidents appear here."}
        </div>
      )}

      <div className="space-y-4">
        {incidents.map(i => {
          const closed = i.status === "closed"
          return (
            <div
              key={i.id}
              className={
                "rounded-lg border p-4 " +
                (closed
                  ? "border-line bg-surface"
                  : i.kind === "injury"
                    ? "border-danger/60 bg-surface"
                    : "border-warning/50 bg-surface")
              }
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="font-semibold text-ink">
                    {KIND_LABEL[i.kind]} — {i.jobName}
                  </h3>
                  <p className="text-xs text-ink-subtle mt-0.5">
                    Happened {fmt(i.occurredAt)} · reported by {i.reportedBy} {fmt(i.reportedAt)}
                    {i.hasLocation ? " · location recorded" : ""}
                  </p>
                </div>
                <span
                  className={
                    "shrink-0 text-xs font-bold rounded-full px-2.5 py-1 " +
                    (closed
                      ? "bg-surface-hover text-ink-subtle"
                      : i.status === "acknowledged"
                        ? "bg-warning/20 text-warning"
                        : "bg-danger/15 text-danger")
                  }
                >
                  {closed ? "Closed" : i.status === "acknowledged" ? "Acknowledged" : "Open"}
                </span>
              </div>

              <p className="text-sm text-ink mt-3 whitespace-pre-wrap">{i.description}</p>

              {i.photoUrls.length > 0 && (
                <div className="flex gap-2 mt-3 flex-wrap">
                  {i.photoUrls.map(u => (
                    <a key={u} href={u} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt="" className="h-24 w-24 object-cover rounded-md border border-line" />
                    </a>
                  ))}
                </div>
              )}

              {closed ? (
                <div className="mt-3 pt-3 border-t border-line">
                  <p className="text-xs uppercase tracking-wide text-ink-subtle mb-1">
                    Closed by {i.closedBy} · {fmt(i.closedAt)}
                  </p>
                  <p className="text-sm text-ink-subtle whitespace-pre-wrap">{i.closureNotes}</p>
                </div>
              ) : closing === i.id ? (
                <div className="mt-3 pt-3 border-t border-line space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-ink mb-1">
                      What was done about it?
                    </label>
                    <textarea
                      value={notes}
                      onChange={e => setNotes(e.target.value)}
                      rows={3}
                      maxLength={8000}
                      className={inp}
                      placeholder="Guard rail refitted and the scaffolder re-inspected the lift. Briefed the crew at the morning start."
                    />
                    <p className="text-xs text-ink-subtle mt-1">
                      Required. This note is the only part of the closure anyone reads later.
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => act(i.id, "close", notes)}
                      disabled={busy || !notes.trim()}
                      className="bg-accent hover:bg-accent-ink text-white font-bold rounded-md px-5 py-2 text-sm disabled:opacity-50"
                    >
                      {busy ? "Closing…" : "Close incident"}
                    </button>
                    <button
                      onClick={() => { setClosing(null); setNotes("") }}
                      className="text-ink-subtle hover:text-ink px-3 py-2 text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-3 mt-3">
                  {i.status === "open" && (
                    <button
                      onClick={() => act(i.id, "acknowledge")}
                      disabled={busy}
                      className="bg-surface-hover hover:bg-line text-ink font-bold rounded-md px-4 py-2 text-sm disabled:opacity-50"
                    >
                      Acknowledge
                    </button>
                  )}
                  <button
                    onClick={() => { setClosing(i.id); setNotes("") }}
                    className="bg-accent hover:bg-accent-ink text-white font-bold rounded-md px-4 py-2 text-sm"
                  >
                    Close with notes
                  </button>
                  {i.acknowledgedBy && (
                    <span className="text-xs text-ink-subtle self-center">
                      Acknowledged by {i.acknowledgedBy} {fmt(i.acknowledgedAt)}
                    </span>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </PageTransition>
  )
}
