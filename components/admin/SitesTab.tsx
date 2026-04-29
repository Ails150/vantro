"use client"

import { useEffect, useState } from "react"
import CsvImportModal, { CsvField } from "./CsvImportModal"

interface Site {
  id: string
  name: string
  address: string
  postcode?: string | null
  client_name?: string | null
  notes?: string | null
  lat?: number | null
  lng?: number | null
  is_active: boolean
  created_at: string
}

const SITE_CSV_FIELDS: CsvField[] = [
  { key: "name", label: "Name", required: true, example: "Persimmon — Greenfield" },
  { key: "address", label: "Address", required: true, example: "12 Greenfield Way, Plot 4" },
  { key: "postcode", label: "Postcode", example: "BT34 5AB" },
  { key: "client_name", label: "Client", example: "Persimmon Homes" },
  { key: "notes", label: "Notes", example: "Phase 2 of 4" },
]

export default function SitesTab() {
  const [sites, setSites] = useState<Site[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [editing, setEditing] = useState<Site | null>(null)
  const [error, setError] = useState("")

  // Form state
  const [form, setForm] = useState({ name: "", address: "", postcode: "", client_name: "", notes: "" })
  const [saving, setSaving] = useState(false)

  const sub = "text-gray-500"
  const card = "bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm"

  async function loadSites() {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/sites")
      const data = await res.json()
      if (res.ok) setSites(data.sites || [])
    } catch {}
    setLoading(false)
  }

  useEffect(() => { loadSites() }, [])

  function startEdit(site: Site) {
    setEditing(site)
    setForm({
      name: site.name,
      address: site.address,
      postcode: site.postcode || "",
      client_name: site.client_name || "",
      notes: site.notes || "",
    })
    setShowAdd(true)
  }

  function startAdd() {
    setEditing(null)
    setForm({ name: "", address: "", postcode: "", client_name: "", notes: "" })
    setShowAdd(true)
    setError("")
  }

  function closeForm() {
    setShowAdd(false)
    setEditing(null)
    setForm({ name: "", address: "", postcode: "", client_name: "", notes: "" })
    setError("")
  }

  async function saveSite() {
    if (!form.name.trim() || !form.address.trim()) {
      setError("Name and address are required")
      return
    }
    setSaving(true)
    setError("")
    try {
      const url = editing ? `/api/admin/sites/${editing.id}` : "/api/admin/sites"
      const method = editing ? "PATCH" : "POST"
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "Could not save")
        setSaving(false)
        return
      }
      closeForm()
      loadSites()
    } catch (err: any) {
      setError(err?.message || "Network error")
    } finally {
      setSaving(false)
    }
  }

  async function deleteSite(site: Site) {
    if (!confirm(`Delete "${site.name}"? Existing jobs that reference this site will keep working.`)) return
    try {
      const res = await fetch(`/api/admin/sites/${site.id}`, { method: "DELETE" })
      if (res.ok) loadSites()
    } catch {}
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-end gap-3">
        <button
          onClick={() => setShowImport(true)}
          className="px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:border-teal-300"
        >
          Import CSV
        </button>
        <button
          onClick={startAdd}
          className="px-4 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-xl text-sm font-semibold"
        >
          + Add site
        </button>
      </div>

      {showAdd && (
        <div className={card + " p-6"}>
          <h3 className="font-semibold mb-4">{editing ? "Edit site" : "New site"}</h3>
          <div className="space-y-3">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Site name (e.g. Persimmon — Greenfield)"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-teal-400"
            />
            <input
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="Address"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-teal-400"
            />
            <div className="grid grid-cols-2 gap-3">
              <input
                value={form.postcode}
                onChange={(e) => setForm({ ...form, postcode: e.target.value })}
                placeholder="Postcode"
                className="border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-teal-400"
              />
              <input
                value={form.client_name}
                onChange={(e) => setForm({ ...form, client_name: e.target.value })}
                placeholder="Client name (optional)"
                className="border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-teal-400"
              />
            </div>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Notes (optional)"
              rows={2}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-teal-400"
            />
            {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{error}</p>}
            <div className="flex gap-2 justify-end">
              <button onClick={closeForm} className="px-4 py-2 text-gray-600 hover:bg-gray-50 rounded-lg text-sm">Cancel</button>
              <button
                onClick={saveSite}
                disabled={saving}
                className="px-4 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {saving ? "Saving…" : editing ? "Save changes" : "Add site"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={card}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <span className="font-semibold">Sites ({sites.length})</span>
          {loading && <span className={"text-sm " + sub}>Loading…</span>}
        </div>
        {!loading && sites.length === 0 ? (
          <div className={"px-6 py-16 text-center " + sub}>
            <p className="mb-3">No sites yet</p>
            <p className="text-xs">Sites are reusable client locations. Add one or import many from CSV.</p>
          </div>
        ) : (
          sites.map((site) => (
            <div key={site.id} className="border-b border-gray-50 last:border-0 flex items-center gap-4 px-6 py-4 hover:bg-gray-50">
              <div className="flex-1">
                <div className="font-semibold">{site.name}</div>
                <div className={"text-sm " + sub}>
                  {site.address}{site.postcode ? `, ${site.postcode}` : ""}
                </div>
                {site.client_name && (
                  <div className={"text-xs " + sub + " mt-0.5"}>Client: {site.client_name}</div>
                )}
                {site.notes && (
                  <div className={"text-xs " + sub + " mt-0.5 italic"}>{site.notes}</div>
                )}
              </div>
              <button
                onClick={() => startEdit(site)}
                className="text-xs text-gray-500 hover:text-teal-600 border border-gray-200 rounded-lg px-3 py-1.5"
              >
                Edit
              </button>
              <button
                onClick={() => deleteSite(site)}
                className="text-xs text-gray-400 hover:text-red-600 border border-gray-200 rounded-lg px-3 py-1.5"
              >
                Delete
              </button>
            </div>
          ))
        )}
      </div>

      <CsvImportModal
        open={showImport}
        onClose={() => setShowImport(false)}
        onSuccess={() => loadSites()}
        title="Import sites from CSV"
        endpoint="/api/admin/sites/bulk-import"
        fields={SITE_CSV_FIELDS}
        templateFilename="vantro-sites-template.csv"
        maxRows={500}
      />
    </div>
  )
}
