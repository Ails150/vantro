"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

interface Props {
  open: boolean
  onClose: () => void
  companyName: string
}

export default function DeleteAccountModal({ open, onClose, companyName }: Props) {
  const [step, setStep] = useState<1 | 2>(1)
  const [confirmation, setConfirmation] = useState("")
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState("")
  const router = useRouter()

  if (!open) return null

  function reset() {
    setStep(1)
    setConfirmation("")
    setError("")
    setDeleting(false)
  }

  function handleClose() {
    if (deleting) return
    reset()
    onClose()
  }

  async function handleDelete() {
    setDeleting(true)
    setError("")
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: confirmation.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "Could not delete account")
        setDeleting(false)
        return
      }
      // Account deleted successfully - redirect to landing
      router.push("/?deleted=1")
    } catch (err: any) {
      setError(err?.message || "Network error")
      setDeleting(false)
    }
  }

  const inp = "w-full bg-white border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-red-500"

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-red-600">Delete account</h2>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none" disabled={deleting}>x</button>
        </div>

        {step === 1 && (
          <div className="px-6 py-5 space-y-4">
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-2">
              <p className="text-sm font-semibold text-red-900">This is permanent and cannot be undone.</p>
              <p className="text-sm text-red-800">Deleting <strong>{companyName}</strong> will:</p>
              <ul className="text-sm text-red-800 space-y-1 list-disc list-inside ml-1">
                <li>Cancel your Vantro subscription immediately</li>
                <li>Delete all jobs, sites, installers, and scheduled work</li>
                <li>Delete all diary entries, defects, QA submissions, and audit packs</li>
                <li>Delete all installer photos and videos</li>
                <li>Sign you out and remove your login</li>
              </ul>
              <p className="text-sm text-red-800 pt-2">No backups. No grace period. No recovery.</p>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button onClick={handleClose} className="px-4 py-2 text-gray-600 hover:bg-gray-50 rounded-lg text-sm">Cancel</button>
              <button
                onClick={() => setStep(2)}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium"
              >
                I understand, continue
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="px-6 py-5 space-y-4">
            <p className="text-sm text-gray-700">
              To confirm deletion, type your company name exactly:
            </p>
            <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 font-mono text-sm text-gray-800">
              {companyName}
            </div>
            <input
              type="text"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              placeholder="Type company name to confirm"
              className={inp}
              disabled={deleting}
              autoFocus
            />

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => { setStep(1); setConfirmation(""); setError("") }}
                className="px-4 py-2 text-gray-600 hover:bg-gray-50 rounded-lg text-sm"
                disabled={deleting}
              >
                Back
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting || confirmation.trim() !== companyName}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deleting ? "Deleting..." : "Delete account permanently"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
