"use client"

import { useState } from "react"
import { VERTICALS, verticalConfig, type Vertical } from "@/lib/vertical"

/**
 * "What does your team do?", asked where the answer matters.
 *
 * It used to be step one of the setup wizard: a screen between a new customer
 * and their first job, asking a question that changes only wording and which
 * tabs appear. The column is NOT NULL with a default, so an unanswered company
 * was already running as an installer and nothing was broken by waiting.
 *
 * So it waits. The first time somebody opens a screen whose language depends on
 * the answer, this asks once, inline, and can be dismissed. companies
 * .vertical_set_at is what separates an answer from the default -- without it
 * the column could never say whether anybody had been asked.
 */
export default function VerticalPrompt({
  current,
  onSaved,
}: {
  current: string | null | undefined
  onSaved: (v: Vertical) => void
}) {
  const [busy, setBusy] = useState<Vertical | null>(null)
  const [hidden, setHidden] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (hidden) return null

  async function pick(v: Vertical) {
    setBusy(v)
    setError(null)
    const res = await fetch("/api/admin/setup/vertical", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vertical: v }),
    })
    setBusy(null)
    if (!res.ok) {
      setError("Could not save that. It can wait — nothing depends on it today.")
      return
    }
    onSaved(v)
    setHidden(true)
  }

  return (
    <div className="mb-4 rounded-lg border border-line bg-canvas p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-ink">What does your team do?</p>
        <button onClick={() => setHidden(true)} className="text-xs text-ink-subtle underline hover:text-ink">
          Not now
        </button>
      </div>
      <p className="mt-0.5 text-xs text-ink-muted">
        It sets the wording across the app — {current ? "currently " + verticalConfig(current as Vertical).workersLower : "workers"}.
        You can change it later in Settings.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {VERTICALS.map(v => (
          <button
            key={v}
            onClick={() => pick(v)}
            disabled={!!busy}
            className={
              "rounded-full border px-3 py-1.5 text-xs transition-colors disabled:opacity-50 " +
              (v === current
                ? "border-accent bg-accent-wash text-accent-ink"
                : "border-line text-ink-muted hover:text-ink")
            }
          >
            {busy === v ? "Saving…" : verticalConfig(v).label}
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  )
}
