"use client"
import { useEffect, useState } from "react"
import { payrollLine, type PayrollRun, type PayrollWeek } from "@/lib/payroll-runs"

/**
 * Starts the payroll clock when last week is opened, locks the week on Approve
 * all, and unlocks it with a reason. A week can only be approved once it has
 * ended, so this week only explains that. Renders nothing for anyone the route
 * refuses, such as a foreman.
 */
export default function PayrollRunBar({ week, hasShifts }: { week: PayrollWeek; hasShifts: boolean }) {
  const [run, setRun] = useState<PayrollRun | null>(null)
  const [canApprove, setCanApprove] = useState(false)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unlocking, setUnlocking] = useState(false)
  const [reason, setReason] = useState("")

  async function post(action: "open" | "approve" | "unlock", extra: Record<string, string> = {}) {
    const res = await fetch("/api/admin/payroll-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, week, ...extra }),
    })
    const body = await res.json().catch(() => ({}))
    return { res, body }
  }

  useEffect(() => {
    if (week !== "last_week") return
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

  async function act(action: "approve" | "unlock", extra: Record<string, string> = {}) {
    setBusy(true)
    setError(null)
    try {
      const { res, body } = await post(action, extra)
      if (res.ok) {
        setRun(body.run)
        setUnlocking(false)
        setReason("")
      } else {
        setError(body.error || `Could not ${action} (${res.status})`)
      }
    } catch (e: any) {
      setError(e?.message || `Could not ${action}`)
    }
    setBusy(false)
  }

  const shell = "bg-white border border-gray-200 rounded-2xl p-5 shadow-sm"

  if (week === "this_week") {
    return (
      <div className={shell} data-testid="payroll-run-bar">
        <p className="text-xs text-gray-500">A week can be approved once it has ended. Last week is ready when you are.</p>
      </div>
    )
  }

  if (!ready) return null
  const line = payrollLine(run, "Last week")

  return (
    <div className={shell} data-testid="payroll-run-bar">
      {line ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-gray-900" data-testid="payroll-run-line">{line}</p>
              <p className="text-xs text-gray-500 mt-0.5">Approved and locked. Shifts and bonuses in this week cannot be changed, and Xero gets exactly this.</p>
            </div>
            {canApprove && !unlocking && (
              <button type="button" onClick={() => setUnlocking(true)} data-testid="payroll-unlock" className="shrink-0 px-4 py-2 rounded-xl text-sm font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200">
                Unlock
              </button>
            )}
          </div>
          {unlocking && (
            <div className="mt-3 flex items-center gap-2">
              <input
                value={reason}
                onChange={e => setReason(e.target.value)}
                maxLength={2000}
                placeholder="Why does this week need unlocking?"
                data-testid="payroll-unlock-reason"
                className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-teal-400"
              />
              <button type="button" disabled={busy || !reason.trim()} onClick={() => act("unlock", { reason })} data-testid="payroll-unlock-confirm" className="shrink-0 px-4 py-2 rounded-xl text-sm font-semibold bg-teal-400 text-white disabled:opacity-50">
                {busy ? "Unlocking..." : "Unlock week"}
              </button>
              <button type="button" onClick={() => { setUnlocking(false); setReason("") }} className="shrink-0 text-xs text-gray-500">Cancel</button>
            </div>
          )}
        </>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-gray-500">
            {hasShifts
              ? "Approve all locks this week's shifts and bonuses and freezes the Xero timesheet. An admin can unlock it, with a reason."
              : "No finished shifts to approve in this week."}
          </p>
          {canApprove && (
            <button
              type="button"
              onClick={() => act("approve")}
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
