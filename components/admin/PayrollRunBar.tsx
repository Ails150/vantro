"use client"
import { useEffect, useState } from "react"
import { payrollLine, type PayrollRun, type PayrollWeek } from "@/lib/payroll-runs"

/**
 * Starts the payroll clock when a week is opened, and stops it on Approve all.
 * Renders nothing for anyone the route refuses, such as a foreman.
 */
export default function PayrollRunBar({ week, hasShifts }: { week: PayrollWeek; hasShifts: boolean }) {
  const [run, setRun] = useState<PayrollRun | null>(null)
  const [canApprove, setCanApprove] = useState(false)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function post(action: "open" | "approve") {
    const res = await fetch("/api/admin/payroll-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, week }),
    })
    const body = await res.json().catch(() => ({}))
    return { res, body }
  }

  useEffect(() => {
    let cancelled = false
    post("open")
      .then(({ res, body }) => {
        if (cancelled || !res.ok) return
        setRun(body.run)
        setCanApprove(!!body.canApprove)
        setReady(true)
      })
      .catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week])

  async function approve() {
    setBusy(true)
    setError(null)
    try {
      const { res, body } = await post("approve")
      if (res.ok) setRun(body.run)
      else setError(body.error || `Could not approve (${res.status})`)
    } catch (e: any) {
      setError(e?.message || "Could not approve")
    }
    setBusy(false)
  }

  if (!ready) return null
  const label = week === "this_week" ? "This week" : "Last week"
  const line = payrollLine(run, label)

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm" data-testid="payroll-run-bar">
      {line ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-gray-900" data-testid="payroll-run-line">{line}</p>
          <span className="text-xs font-semibold text-teal-600">Approved</span>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-gray-500">
            {hasShifts
              ? "Approve all records this week as approved. It does not lock hours or change pay."
              : "No finished shifts to approve in this week."}
          </p>
          {canApprove && (
            <button
              type="button"
              onClick={approve}
              disabled={busy || !hasShifts}
              data-testid="payroll-approve-all"
              className="shrink-0 px-4 py-2 rounded-xl text-sm font-semibold bg-teal-400 text-white disabled:opacity-50"
            >
              {busy ? "Approving..." : "Approve all"}
            </button>
          )}
        </div>
      )}
      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
    </div>
  )
}
