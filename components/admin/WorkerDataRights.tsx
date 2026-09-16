"use client"
import { useState } from "react"
import { ERASURE_CAVEATS } from "@/lib/gdpr"

/**
 * Article 15 and 17 for one worker, on that worker's card.
 *
 * Here rather than on a settings screen because a subject access request
 * arrives as "Marek wants his data" and the admin's first move is to find Marek.
 * A separate compliance screen is one more place to look under a statutory
 * deadline.
 *
 * The erasure confirmation shows the caveats BEFORE it will accept the typed
 * name. A person told their data was erased who later finds their name on a
 * signed audit pack has been misled, and the company that told them carries
 * that, so the admin has to see the limits before they can promise anything.
 */
export default function WorkerDataRights({
  userId,
  userName,
  anonymisedAt,
  onErased,
}: {
  userId: string
  userName: string
  anonymisedAt?: string | null
  onErased?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [typed, setTyped] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (anonymisedAt) {
    return (
      <p className="text-[10px] text-ink-subtle">
        Erased {new Date(anonymisedAt).toLocaleDateString("en-GB")} at their request
      </p>
    )
  }

  async function erase() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/team/erase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, confirmation: typed.trim() }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(body.error || `Could not erase (${res.status})`); return }
      onErased?.()
    } catch (e: any) {
      setError(e?.message || "Could not erase")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-[10px] text-ink-subtle underline hover:text-ink"
        >
          Data rights
        </button>
      ) : (
        <div className="rounded-md border border-line bg-surface p-3 space-y-2">
          <p className="text-[10px] uppercase tracking-wide text-ink-subtle">
            Subject access and erasure
          </p>

          <div className="flex flex-wrap gap-2">
            <a
              href={`/api/admin/team/export?userId=${encodeURIComponent(userId)}&format=pdf`}
              className="text-xs text-accent-ink underline"
            >
              Download PDF
            </a>
            <a
              href={`/api/admin/team/export?userId=${encodeURIComponent(userId)}&format=json`}
              className="text-xs text-accent-ink underline"
            >
              Download JSON
            </a>
          </div>
          <p className="text-[10px] text-ink-subtle">
            The PDF is for the person. The JSON is the complete copy, for a
            solicitor or another employer.
          </p>

          {!confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="text-xs text-danger underline"
            >
              Erase this person
            </button>
          ) : (
            <div className="space-y-2 border-t border-line pt-2">
              <p className="text-xs text-ink">
                This cannot be undone. Read what it does and does not reach:
              </p>
              <ul className="list-disc pl-4 space-y-1">
                {ERASURE_CAVEATS.map(c => (
                  <li key={c} className="text-[10px] text-ink-subtle">{c}</li>
                ))}
              </ul>
              <p className="text-xs text-ink">
                Type <strong>{userName}</strong> to confirm.
              </p>
              <input
                value={typed}
                onChange={e => setTyped(e.target.value)}
                placeholder={userName}
                className="w-full rounded border border-line-strong bg-canvas px-2 py-1 text-xs text-ink focus:border-accent focus:outline-none"
              />
              {error && <p className="text-[10px] text-danger">{error}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={erase}
                  disabled={busy || typed.trim() !== userName}
                  className="rounded bg-danger px-3 py-1 text-xs font-bold text-white disabled:opacity-40"
                >
                  {busy ? "Erasing…" : "Erase permanently"}
                </button>
                <button
                  type="button"
                  onClick={() => { setConfirming(false); setTyped(""); setError(null) }}
                  className="text-xs text-ink-subtle"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => { setOpen(false); setConfirming(false); setTyped(""); setError(null) }}
            className="text-[10px] text-ink-subtle underline"
          >
            Close
          </button>
        </div>
      )}
    </div>
  )
}
