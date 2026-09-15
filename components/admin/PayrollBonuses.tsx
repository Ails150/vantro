"use client"
import { useCallback, useEffect, useState } from "react"
import { formatPay, parseBonusAmount } from "@/lib/pay"

/**
 * Bonuses for one worker in the period on screen.
 *
 * Inside the payroll row rather than on a screen of its own, because a bonus is
 * decided while looking at somebody's week -- "he covered Saturday, give him
 * fifty" -- and a separate page is one nobody navigates to at the moment the
 * thought occurs.
 *
 * There is no edit. A bonus is a decision made on a day, and editing the amount
 * afterwards leaves a record reading as though a different decision was made.
 * Remove and re-award leaves two honest rows.
 */
export default function PayrollBonuses({
  userId,
  userName,
  from,
  to,
  onChanged,
}: {
  userId: string
  userName: string
  /** ISO datetimes for the period on screen; only the date part is used. */
  from: string
  to: string
  onChanged?: () => void
}) {
  const [bonuses, setBonuses] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [gated, setGated] = useState(false)
  const [adding, setAdding] = useState(false)
  const [amount, setAmount] = useState("")
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({
        userId,
        from: from.slice(0, 10),
        to: to.slice(0, 10),
      })
      const res = await fetch(`/api/admin/bonuses?${qs}`)
      if (res.status === 402) { setGated(true); return }
      if (!res.ok) return
      const body = await res.json()
      setBonuses(body.bonuses || [])
    } catch {
      // A bonus list that will not load must not take the payroll row with it.
    } finally {
      setLoading(false)
    }
  }, [userId, from, to])

  useEffect(() => { load() }, [load])

  async function award() {
    const parsed = parseBonusAmount(amount)
    if (!parsed.ok) { setError(parsed.why); return }
    if (!reason.trim()) {
      setError("A reason is required. A bonus with no reason is a typo six months from now.")
      return
    }

    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/bonuses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, amount: parsed.amount, reason: reason.trim() }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(body.error || `Could not save (${res.status})`); return }
      setAmount("")
      setReason("")
      setAdding(false)
      await load()
      onChanged?.()
    } catch (e: any) {
      setError(e?.message || "Could not save")
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/bonuses?id=${encodeURIComponent(id)}`, { method: "DELETE" })
      if (res.ok) { await load(); onChanged?.() }
    } catch {
      // Same reasoning as load(): a failed delete is not worth breaking the row.
    } finally {
      setSaving(false)
    }
  }

  if (gated || loading) return null

  const total = bonuses.reduce((sum, b) => sum + Math.round(Number(b.amount) * 100), 0) / 100

  return (
    <div className="bg-gray-50 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold">Bonuses</span>
        {bonuses.length > 0 && (
          <span className={"text-sm font-bold " + (total < 0 ? "text-red-600" : "text-gray-900")}>
            {formatPay(total)}
          </span>
        )}
      </div>

      {bonuses.length === 0 && !adding && (
        <p className="text-sm text-gray-500 mb-3">Nothing this period.</p>
      )}

      {bonuses.map(b => (
        <div key={b.id} className="py-2 border-b border-gray-100 last:border-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className={"text-sm font-semibold " + (b.amount < 0 ? "text-red-600" : "")}>
                {formatPay(b.amount)}
              </div>
              <div className="text-xs text-gray-500 break-words">{b.reason}</div>
              <div className="text-xs text-gray-400">{b.awardedOn}</div>
            </div>
            <button
              onClick={() => remove(b.id)}
              disabled={saving}
              className="text-xs text-gray-400 hover:text-red-600 shrink-0"
            >
              Remove
            </button>
          </div>
        </div>
      ))}

      {adding ? (
        <div className="space-y-2 mt-3">
          <input
            type="number"
            step="0.01"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="Amount, or a negative for a deduction"
            className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-teal-400"
          />
          <input
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Why — covered Saturday at short notice"
            maxLength={2000}
            className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-teal-400"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={award}
              disabled={saving}
              className="text-xs bg-teal-400 text-white font-semibold rounded-lg px-3 py-1.5 disabled:opacity-50"
            >
              {saving ? "Saving..." : `Award to ${userName.split(" ")[0]}`}
            </button>
            <button
              onClick={() => { setAdding(false); setError(null) }}
              className="text-xs text-gray-500 px-2"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="text-xs text-teal-600 hover:underline mt-2"
        >
          Add a bonus or deduction
        </button>
      )}
    </div>
  )
}
