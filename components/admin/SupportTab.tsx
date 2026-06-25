"use client"
import { useEffect, useRef, useState } from "react"

type Ticket = {
  id: string
  title: string
  description: string
  screenshot_url: string | null
  status: "open" | "in_progress" | "resolved"
  created_at: string
  updated_at: string
}

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
}
const STATUS_STYLE: Record<string, string> = {
  open: "bg-amber-50 text-amber-700",
  in_progress: "bg-blue-50 text-blue-700",
  resolved: "bg-teal-50 text-teal-600",
}

const inp = "w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-teal-300"

export default function SupportTab() {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const fileRef = useRef<HTMLInputElement>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/support/tickets")
      const data = await res.json()
      if (res.ok) setTickets(data.tickets || [])
    } catch {}
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function submit() {
    if (!title.trim()) { setError("Enter a title"); return }
    if (!description.trim()) { setError("Enter a description"); return }
    setSaving(true); setError("")
    try {
      const fd = new FormData()
      fd.append("title", title.trim())
      fd.append("description", description.trim())
      if (file) fd.append("screenshot", file)
      const res = await fetch("/api/support/tickets", { method: "POST", body: fd })
      const data = await res.json()
      if (!res.ok) { setError(data.error || "Something went wrong"); setSaving(false); return }
      setTitle(""); setDescription(""); setFile(null)
      if (fileRef.current) fileRef.current.value = ""
      setShowForm(false)
      await load()
    } catch {
      setError("Something went wrong. Please try again.")
    }
    setSaving(false)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Support</h2>
          <p className="text-sm text-gray-500">Raise a ticket and our team will get back to you by email.</p>
        </div>
        <button
          onClick={() => { setShowForm(v => !v); setError("") }}
          className="bg-teal-400 hover:bg-teal-500 text-white text-sm font-semibold rounded-xl px-4 py-2.5 transition-colors">
          {showForm ? "Close" : "New ticket"}
        </button>
      </div>

      {showForm && (
        <div className="bg-white border border-teal-200 rounded-2xl p-6 space-y-4 shadow-sm">
          <h3 className="font-semibold">New support ticket</h3>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title — a short summary" className={inp}/>
          <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Describe the issue in detail..." rows={5} className={inp + " resize-y"}/>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Screenshot (optional)</label>
            <input ref={fileRef} type="file" accept="image/*" onChange={e => setFile(e.target.files?.[0] || null)} className="text-sm text-gray-600"/>
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex gap-3">
            <button onClick={submit} disabled={saving} className="bg-teal-400 hover:bg-teal-500 disabled:opacity-50 text-white text-sm font-semibold rounded-xl px-4 py-2.5 transition-colors">
              {saving ? "Sending..." : "Submit ticket"}
            </button>
            <button onClick={() => { setShowForm(false); setError("") }} className="text-sm text-gray-600 hover:text-gray-800 rounded-xl px-4 py-2.5">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm">
        <div className="px-6 pt-5 pb-3 border-b border-gray-100 font-semibold text-sm">Your tickets</div>
        {loading ? (
          <div className="px-6 py-12 text-center text-sm text-gray-400">Loading...</div>
        ) : tickets.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-gray-400">No tickets yet</div>
        ) : (
          tickets.map(t => (
            <div key={t.id} className="border-b border-gray-50 last:border-0 px-6 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm">{t.title}</div>
                  <div className="text-sm text-gray-500 mt-0.5 whitespace-pre-wrap break-words">{t.description}</div>
                  {t.screenshot_url && (
                    <a href={t.screenshot_url} target="_blank" rel="noreferrer" className="text-xs text-teal-600 underline mt-1 inline-block">View screenshot</a>
                  )}
                  <div className="text-xs text-gray-400 mt-1">{new Date(t.created_at).toLocaleString()}</div>
                </div>
                <span className={"text-xs px-3 py-1 rounded-full font-medium flex-shrink-0 " + (STATUS_STYLE[t.status] || "bg-gray-100 text-gray-500")}>
                  {STATUS_LABEL[t.status] || t.status}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
