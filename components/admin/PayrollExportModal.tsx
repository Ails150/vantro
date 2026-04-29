"use client"

import { useEffect, useState } from "react"

interface Props {
  open: boolean
  onClose: () => void
  onExported?: () => void
}

interface PreviewSummary {
  signinCount: number
  totalHours: number
  flaggedCount: number
  uniqueInstallers: number
}

interface InstallerSummary {
  installer: string
  email: string
  sessions: number
  hours: number
  flagged: number
}

export default function PayrollExportModal({ open, onClose, onExported }: Props) {
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [preview, setPreview] = useState<PreviewSummary | null>(null)
  const [byInstaller, setByInstaller] = useState<InstallerSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState("")
  const [confirmOpen, setConfirmOpen] = useState(false)

  // Default range = last week (Mon-Sun)
  useEffect(() => {
    if (!open) return
    const now = new Date()
    const day = now.getDay() // 0 Sun, 1 Mon...
    const lastSunday = new Date(now)
    lastSunday.setDate(now.getDate() - (day === 0 ? 7 : day))
    lastSunday.setHours(23, 59, 59, 999)
    const lastMonday = new Date(lastSunday)
    lastMonday.setDate(lastSunday.getDate() - 6)
    lastMonday.setHours(0, 0, 0, 0)
    setFrom(lastMonday.toISOString().slice(0, 10))
    setTo(lastSunday.toISOString().slice(0, 10))
  }, [open])

  useEffect(() => {
    if (!open || !from || !to) return
    fetchPreview()
  }, [from, to, open])

  async function fetchPreview() {
    setLoading(true)
    setError("")
    try {
      const fromIso = new Date(from + "T00:00:00").toISOString()
      const toIso = new Date(to + "T23:59:59").toISOString()
      const res = await fetch(`/api/payroll/export?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`)
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "Could not load preview")
        setPreview(null)
        return
      }
      setPreview(data.summary)
      setByInstaller(data.byInstaller || [])
    } catch (err: any) {
      setError(err?.message || "Network error")
    } finally {
      setLoading(false)
    }
  }

  async function doExport() {
    setExporting(true)
    setError("")
    try {
      const fromIso = new Date(from + "T00:00:00").toISOString()
      const toIso = new Date(to + "T23:59:59").toISOString()
      const res = await fetch("/api/payroll/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: fromIso, to: toIso }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Export failed")
        setExporting(false)
        return
      }
      // Download the CSV
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `vantro-payroll-${from}-to-${to}.csv`
      a.click()
      URL.revokeObjectURL(url)
      setConfirmOpen(false)
      if (onExported) onExported()
      onClose()
    } catch (err: any) {
      setError(err?.message || "Network error")
    } finally {
      setExporting(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Export payroll to CSV</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-5 text-sm text-amber-800">
            <strong>Important:</strong> Exporting locks all timesheets in this date range. Once locked, sign-in/out times cannot be edited.
          </div>

          <div className="grid grid-cols-2 gap-3 mb-5">
            <div>
              <label className="block text-xs text-gray-600 mb-1">From</label>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-teal-400"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">To</label>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-teal-400"
              />
            </div>
          </div>

          {loading && <p className="text-sm text-gray-500">Loading preview…</p>}

          {!loading && preview && (
            <>
              <div className="grid grid-cols-4 gap-3 mb-5">
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-gray-800">{preview.signinCount}</div>
                  <div className="text-xs text-gray-500">Sessions</div>
                </div>
                <div className="bg-teal-50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-teal-700">{preview.totalHours.toFixed(1)}</div>
                  <div className="text-xs text-teal-700">Total hours</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-gray-800">{preview.uniqueInstallers}</div>
                  <div className="text-xs text-gray-500">Installers</div>
                </div>
                <div className={`rounded-lg p-3 text-center ${preview.flaggedCount > 0 ? "bg-amber-50" : "bg-gray-50"}`}>
                  <div className={`text-2xl font-bold ${preview.flaggedCount > 0 ? "text-amber-700" : "text-gray-800"}`}>{preview.flaggedCount}</div>
                  <div className={`text-xs ${preview.flaggedCount > 0 ? "text-amber-700" : "text-gray-500"}`}>Flagged</div>
                </div>
              </div>

              {preview.flaggedCount > 0 && (
                <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-4">
                  {preview.flaggedCount} session{preview.flaggedCount !== 1 ? "s" : ""} flagged for review.
                  Review the Payroll tab and edit before exporting if needed.
                </p>
              )}

              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="bg-gray-50 px-4 py-2 text-xs font-medium text-gray-600 border-b">By installer</div>
                <div className="max-h-64 overflow-y-auto">
                  {byInstaller.length === 0 ? (
                    <div className="text-sm text-gray-500 px-4 py-6 text-center">No new sessions in this range</div>
                  ) : (
                    byInstaller.map((row) => (
                      <div key={row.email} className="flex items-center justify-between px-4 py-2 border-b border-gray-50 last:border-0 text-sm">
                        <div>
                          <div className="font-medium">{row.installer}</div>
                          <div className="text-xs text-gray-500">{row.email}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold">{row.hours.toFixed(1)}h</div>
                          <div className="text-xs text-gray-500">
                            {row.sessions} session{row.sessions !== 1 ? "s" : ""}
                            {row.flagged > 0 ? ` · ${row.flagged} flagged` : ""}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}

          {error && (
            <p className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{error}</p>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-50 rounded-lg">Cancel</button>
          <button
            onClick={() => setConfirmOpen(true)}
            disabled={!preview || preview.signinCount === 0 || loading}
            className="px-4 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-lg disabled:opacity-50"
          >
            Lock & download CSV
          </button>
        </div>
      </div>

      {/* Confirm modal */}
      {confirmOpen && preview && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold mb-2">Confirm export</h3>
            <p className="text-sm text-gray-600 mb-4">
              You're about to lock <strong>{preview.signinCount}</strong> sessions
              ({preview.totalHours.toFixed(1)} hours) from {from} to {to}.
              These will become read-only. Continue?
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmOpen(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-50 rounded-lg">Cancel</button>
              <button
                onClick={doExport}
                disabled={exporting}
                className="px-4 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-lg disabled:opacity-50"
              >
                {exporting ? "Exporting…" : "Yes, lock & download"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
