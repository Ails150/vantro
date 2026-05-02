"use client"

import { useState } from "react"
import { createClient } from "@/lib/supabase/client"
import DeleteAccountModal from "./DeleteAccountModal"

interface Props {
  open: boolean
  onClose: () => void
  user: any
  userData: any
  company?: any
}

export default function AccountModal({ open, onClose, user, userData, company }: Props) {
  const [name, setName] = useState(userData?.name || "")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState("")
  const [resetSent, setResetSent] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [showDelete, setShowDelete] = useState(false)

  if (!open) return null

  async function saveName() {
    if (!name.trim()) { setError("Name is required"); return }
    setSaving(true); setSaved(false); setError("")
    try {
      const res = await fetch("/api/admin/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "Could not save")
        return
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err: any) {
      setError(err?.message || "Network error")
    } finally {
      setSaving(false)
    }
  }

  async function sendPasswordReset() {
    setResetting(true); setError("")
    try {
      const supabase = createClient()
      const { error: err } = await supabase.auth.resetPasswordForEmail(user.email, {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      if (err) {
        setError(err.message)
      } else {
        setResetSent(true)
      }
    } catch (err: any) {
      setError(err?.message || "Could not send reset email")
    } finally {
      setResetting(false)
    }
  }

  const inp = "w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-teal-400"

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Account</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Email</label>
            <input value={user?.email || ""} disabled className={inp + " bg-gray-50 text-gray-500"} />
            <p className="text-xs text-gray-400 mt-1">Email can't be changed.</p>
          </div>

          <div>
            <label className="block text-xs text-gray-600 mb-1">Your name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inp} />
          </div>

          <div className="pt-3 border-t border-gray-100">
            <label className="block text-xs text-gray-600 mb-2">Password</label>
            {resetSent ? (
              <p className="text-sm text-teal-700 bg-teal-50 border border-teal-200 rounded-lg px-3 py-2">
                Password reset email sent to <strong>{user.email}</strong>. Check your inbox.
              </p>
            ) : (
              <button
                onClick={sendPasswordReset}
                disabled={resetting}
                className="px-4 py-2 border border-gray-200 hover:border-teal-300 rounded-xl text-sm text-gray-700 disabled:opacity-50"
              >
                {resetting ? "Sending…" : "Send password reset email"}
              </button>
            )}
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{error}</p>}

          <div className="pt-5 mt-2 border-t border-red-100">
            <label className="block text-xs text-red-600 font-semibold uppercase tracking-wide mb-2">Danger zone</label>
            <p className="text-xs text-gray-500 mb-3">Permanently delete your company account, subscription, and all data. This cannot be undone.</p>
            <button
              onClick={() => setShowDelete(true)}
              className="px-4 py-2 border border-red-200 hover:bg-red-50 hover:border-red-400 rounded-xl text-sm text-red-600 font-medium"
            >
              Delete my account
            </button>
          </div>
          {saved && <p className="text-sm text-teal-700 font-medium">Saved ✓</p>}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-50 rounded-lg">Close</button>
          <button
            onClick={saveName}
            disabled={saving}
            className="px-4 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
    {showDelete && (
      <DeleteAccountModal
        open={showDelete}
        onClose={() => setShowDelete(false)}
        companyName={company?.name || ""}
      />
    )}
    </>
  )
}
