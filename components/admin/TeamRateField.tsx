"use client"
import { useState } from "react"
import { formatRate, parseRate, resolveRate } from "@/lib/pay"

/**
 * One person's hourly rate, edited in place on their team card.
 *
 * In place rather than behind a modal because the rate is one number and the
 * question "what is Dan on?" is asked while looking at the list. A dialog for a
 * single field is how a rate stays unset.
 *
 * When the rate is blank the card shows the company default and says where it
 * came from, so an admin can see at a glance which people are on the fallback
 * and which have been set deliberately. That distinction is load bearing: a
 * worker on zero is a decision, a worker on the default may just be one nobody
 * has got to yet.
 */
export default function TeamRateField({
  userId,
  hourlyRate,
  companyDefaultRate,
  onSaved,
}: {
  userId: string
  hourlyRate: number | null
  companyDefaultRate: number | null
  onSaved?: (rate: number | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(hourlyRate != null ? String(hourlyRate) : "")
  const [current, setCurrent] = useState<number | null>(hourlyRate)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const resolved = resolveRate(current, companyDefaultRate)

  async function save() {
    // Validated here as well as on the server so the common typo gets an
    // instant sentence rather than a round trip.
    const parsed = parseRate(value)
    if (!parsed.ok) {
      setError(parsed.why)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/team", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, hourly_rate: parsed.rate }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error || `Could not save (${res.status})`)
        return
      }
      setCurrent(parsed.rate)
      setEditing(false)
      onSaved?.(parsed.rate)
    } catch (e: any) {
      setError(e?.message || "Could not save")
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => { setValue(current != null ? String(current) : ""); setEditing(true); setError(null) }}
        className="text-left text-xs text-ink-muted hover:text-accent-ink transition-colors"
        title="Set hourly rate"
      >
        <span className="num text-ink">{formatRate(resolved.rate)}</span>
        {resolved.source === "company_default" && (
          <span className="ml-1 text-[10px] text-ink-subtle">(default)</span>
        )}
        {resolved.source === "unset" && (
          <span className="ml-1 text-[10px] text-danger">no rate</span>
        )}
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-ink-subtle">£</span>
      <input
        type="number"
        min="0"
        max="1000"
        step="0.01"
        autoFocus
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter") save()
          if (e.key === "Escape") setEditing(false)
        }}
        placeholder="18.50"
        className="w-20 rounded border border-line-strong bg-canvas px-1.5 py-1 text-xs text-ink focus:border-accent focus:outline-none"
      />
      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="text-xs text-accent-ink hover:underline disabled:opacity-50"
      >
        {saving ? "..." : "Save"}
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="text-xs text-ink-subtle hover:text-ink"
      >
        Cancel
      </button>
      {error && <span className="text-[10px] text-danger">{error}</span>}
    </div>
  )
}
