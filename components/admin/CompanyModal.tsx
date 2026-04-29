"use client"

import { useState } from "react"

interface Props {
  open: boolean
  onClose: () => void
  company: any
}

export default function CompanyModal({ open, onClose, company }: Props) {
  const [name, setName] = useState(company?.name || "")
  const [address, setAddress] = useState(company?.address || "")
  const [phone, setPhone] = useState(company?.phone || "")
  const [contactEmail, setContactEmail] = useState(company?.contact_email || "")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState("")

  if (!open) return null

  async function save() {
    if (!name.trim()) { setError("Company name is required"); return }
    setSaving(true); setSaved(false); setError("")
    try {
      const res = await fetch("/api/admin/company", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          address: address.trim() || null,
          phone: phone.trim() || null,
          contact_email: contactEmail.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "Could not save")
        return
      }
      setSaved(true)
      setTimeout(() => {
        setSaved(false)
        // Reload to refresh server-side props
        window.location.reload()
      }, 1500)
    } catch (err: any) {
      setError(err?.message || "Network error")
    } finally {
      setSaving(false)
    }
  }

  const inp = "w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-teal-400"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Company</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Company name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inp} />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Address</label>
            <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} className={inp} />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Phone</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inp} />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Contact email</label>
            <input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} type="email" className={inp} />
            <p className="text-xs text-gray-400 mt-1">Used for client-facing communication. Defaults to your account email.</p>
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{error}</p>}
          {saved && <p className="text-sm text-teal-700 font-medium">Saved ✓ Refreshing…</p>}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-50 rounded-lg">Close</button>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  )
}
