"use client"

import { useEffect, useState } from "react"

/**
 * TradesTab.tsx
 * Vantro Admin → Setup → Trades
 *
 * Multi-trade v1 (opt-in, harmless to single-trade companies).
 *
 * Schema (company_trades):
 *   company_id  uuid
 *   trade_key   text   (PK part — e.g. 'glazing', 'm_and_e')
 *   label       text   (display name — e.g. 'Glazing', 'M&E')
 *   enabled     boolean
 *   sort_order  integer
 *
 * API: /api/admin/trades  (GET + PATCH)
 *   GET  → { multi_trade_enabled: boolean, trades: Trade[] }
 *   PATCH body shape (either or both):
 *     { multi_trade_enabled?: boolean, trades?: Array<{ trade_key, enabled }> }
 */

type Trade = {
  trade_key: string
  label: string
  enabled: boolean
  sort_order?: number
}

type TradesPayload = {
  multi_trade_enabled: boolean
  trades: Trade[]
}

export default function TradesTab() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState<string | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [trades, setTrades] = useState<Trade[]>([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        setLoading(true)
        setError(null)
        const res = await fetch("/api/admin/trades", { cache: "no-store" })
        if (!res.ok) throw new Error(`Failed to load trades (${res.status})`)
        const data: TradesPayload = await res.json()
        if (cancelled) return
        setEnabled(!!data.multi_trade_enabled)
        const sorted = [...(data.trades || [])].sort((a, b) => {
          const ai = a.sort_order ?? 999
          const bi = b.sort_order ?? 999
          if (ai !== bi) return ai - bi
          return (a.label || "").localeCompare(b.label || "")
        })
        setTrades(sorted)
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load trades")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  function flash(msg: string) {
    setSavedFlash(msg)
    window.setTimeout(() => setSavedFlash(null), 1800)
  }

  async function patchTrades(body: Partial<{ multi_trade_enabled: boolean; trades: Array<{ trade_key: string; enabled: boolean }> }>) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/trades", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const txt = await res.text().catch(() => "")
        throw new Error(`Save failed (${res.status})${txt ? ": " + txt.slice(0, 200) : ""}`)
      }
    } catch (e: any) {
      setError(e?.message || "Save failed")
      throw e
    } finally {
      setSaving(false)
    }
  }

  async function toggleEnabled(next: boolean) {
    const prev = enabled
    setEnabled(next)
    try {
      await patchTrades({ multi_trade_enabled: next })
      flash(next ? "Multi-trade enabled" : "Multi-trade disabled")
    } catch {
      setEnabled(prev)
    }
  }

  async function toggleTrade(trade_key: string, next: boolean) {
    const prev = trades
    setTrades((t) => t.map((x) => (x.trade_key === trade_key ? { ...x, enabled: next } : x)))
    try {
      await patchTrades({ trades: [{ trade_key, enabled: next }] })
      flash("Saved")
    } catch {
      setTrades(prev)
    }
  }

  const enabledCount = trades.filter((t) => t.enabled).length

  // ---- styling tokens (match AdminDashboard.tsx) ----
  const card = "bg-white border border-gray-200 rounded-2xl shadow-sm"
  const cardHeader = "px-6 py-4 border-b border-gray-100 flex items-center justify-between"
  const sub = "text-gray-500"

  return (
    <div className="px-4 md:px-8 py-4 md:py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Trades</h2>
          <p className={"text-sm mt-1 " + sub}>
            Standard UK construction trades. Enable multi-trade to tag jobs, installers and QA checklists by trade.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {savedFlash && (
            <span className="text-xs font-medium text-teal-700 bg-teal-50 border border-teal-200 px-2.5 py-1 rounded-full">
              {savedFlash}
            </span>
          )}
          {saving && <span className={"text-xs " + sub}>Saving…</span>}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {/* Toggle card */}
      <div className={card}>
        <div className={cardHeader}>
          <div>
            <div className="font-semibold text-gray-900">Multi-trade mode</div>
            <div className={"text-xs mt-0.5 " + sub}>
              Off by default. Single-trade companies can leave this disabled — nothing changes.
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            disabled={loading || saving}
            onClick={() => toggleEnabled(!enabled)}
            className={
              "relative inline-flex h-7 w-12 items-center rounded-full transition-colors disabled:opacity-50 " +
              (enabled ? "bg-teal-500" : "bg-gray-300")
            }
          >
            <span
              className={
                "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform " +
                (enabled ? "translate-x-6" : "translate-x-1")
              }
            />
          </button>
        </div>
        <div className="px-6 py-4 text-sm text-gray-700">
          {enabled ? (
            <>
              Multi-trade is <span className="font-semibold text-teal-700">on</span>. Jobs can require specific trades,
              installers can be tagged with their trades, and QA checklist items can be filtered by trade. Mismatched
              installers see a warning but are still allowed on site.
            </>
          ) : (
            <>
              Multi-trade is <span className="font-semibold text-gray-700">off</span>. Vantro behaves as a single-trade
              system — exactly as before.
            </>
          )}
        </div>
      </div>

      {/* Trades list */}
      <div className={card + (enabled ? "" : " opacity-60")}>
        <div className={cardHeader}>
          <div className="flex items-center gap-3">
            <span className="font-semibold text-gray-900">Standard UK trades</span>
            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
              {enabledCount} of {trades.length} enabled
            </span>
          </div>
          <span className={"text-xs " + sub}>Tap to enable</span>
        </div>

        {loading ? (
          <div className={"px-6 py-10 text-center text-sm " + sub}>Loading trades…</div>
        ) : trades.length === 0 ? (
          <div className={"px-6 py-10 text-center text-sm " + sub}>
            No trades found. Run the seed migration for{" "}
            <code className="font-mono text-xs">company_trades</code>.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 p-4">
            {trades.map((t) => {
              const on = t.enabled
              return (
                <button
                  key={t.trade_key}
                  type="button"
                  disabled={!enabled || saving}
                  onClick={() => toggleTrade(t.trade_key, !on)}
                  className={
                    "flex items-center justify-between px-4 py-3 rounded-xl border text-left transition-colors disabled:cursor-not-allowed " +
                    (on
                      ? "bg-teal-50 border-teal-200 text-teal-800 hover:bg-teal-100"
                      : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50")
                  }
                >
                  <span className="text-sm font-medium">{t.label}</span>
                  <span
                    className={
                      "ml-3 h-5 w-5 rounded-full flex items-center justify-center text-[11px] font-bold " +
                      (on ? "bg-teal-500 text-white" : "bg-gray-200 text-gray-500")
                    }
                    aria-hidden
                  >
                    {on ? "✓" : ""}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {!enabled && !loading && trades.length > 0 && (
          <div className={"px-6 py-3 border-t border-gray-100 text-xs " + sub}>
            Enable multi-trade above to start assigning trades to jobs and installers.
          </div>
        )}
      </div>

      {/* Help */}
      <div className="text-xs text-gray-500 leading-relaxed max-w-2xl">
        Once multi-trade is on, you can pick required trades on each job, tag installers with their trades on the team
        page, and filter QA checklist items by trade. Items tagged "all trades" always appear for every installer.
      </div>
    </div>
  )
}
