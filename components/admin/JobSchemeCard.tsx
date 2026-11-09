"use client"
import { useState } from "react"

const WORK_TYPES = ["Replacement windows", "Replacement doors", "Windows and doors", "Roof windows"]

/** A job's scheme details, on the job. Locked once it has gone to the scheme. */
export default function JobSchemeCard({ job, onSaved }: { job: any; onSaved?: () => void }) {
  const [f, setF] = useState({
    notifiable: !!job.notifiable,
    scheme: job.scheme || "",
    property_address: job.property_address || job.address || "",
    work_type: job.work_type || "",
    windows_count: job.windows_count != null ? String(job.windows_count) : "",
    doors_count: job.doors_count != null ? String(job.doors_count) : "",
    completion_date: job.completion_date || "",
    homeowner_name: job.homeowner_name || "",
    homeowner_email: job.homeowner_email || "",
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const status = job.registration_status || "not_required"
  const locked = ["registering", "registered", "unknown"].includes(status)
  const set = (k: string, v: any) => setF(p => ({ ...p, [k]: v }))

  async function save() {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch("/api/admin/schemes/jobs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, ...f }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(res.status === 402 ? "Scheme registration is on the Full Suite plan." : body.error || `Could not save (${res.status})`)
      } else {
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
        onSaved?.()
      }
    } catch (e: any) {
      setError(e?.message || "Could not save")
    }
    setSaving(false)
  }

  const inp = "w-full rounded-md border border-line-strong bg-canvas px-3 py-2 text-sm text-ink disabled:opacity-60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-ink/20"
  const label = "block text-xs font-medium text-ink mb-1"

  return (
    <div className="mt-4 rounded-lg border border-line bg-surface p-4">
      <h4 className="text-sm font-bold text-ink">Scheme registration</h4>
      <label className="mt-3 flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={f.notifiable} disabled={locked} onChange={e => set("notifiable", e.target.checked)} />
        Notifiable work. Register it with the scheme when the job is signed off.
      </label>

      {job.certificate_number && (
        <p className="text-sm text-ink mt-3">
          Certificate <span className="num font-bold">{job.certificate_number}</span>
          {job.registration_environment === "simulator" && <span className="text-warning"> (test, not registered)</span>}
        </p>
      )}
      {job.registration_error && <p className="text-xs text-danger mt-2">{job.registration_error}</p>}

      {f.notifiable && (
        <div className="grid grid-cols-2 gap-3 mt-3">
          <div>
            <label className={label}>Scheme</label>
            <select value={f.scheme} disabled={locked} onChange={e => set("scheme", e.target.value)} className={inp}>
              <option value="">Choose</option>
              <option value="certass">Certass</option>
              <option value="fensa">FENSA</option>
            </select>
          </div>
          <div>
            <label className={label}>Work type</label>
            <select value={f.work_type} disabled={locked} onChange={e => set("work_type", e.target.value)} className={inp}>
              <option value="">Choose</option>
              {WORK_TYPES.map(w => <option key={w} value={w}>{w}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className={label}>Property address</label>
            <input value={f.property_address} disabled={locked} onChange={e => set("property_address", e.target.value)} className={inp} />
          </div>
          <div>
            <label className={label}>Windows</label>
            <input type="number" min="0" max="999" value={f.windows_count} disabled={locked} onChange={e => set("windows_count", e.target.value)} className={inp} />
          </div>
          <div>
            <label className={label}>Doors</label>
            <input type="number" min="0" max="999" value={f.doors_count} disabled={locked} onChange={e => set("doors_count", e.target.value)} className={inp} />
          </div>
          <div>
            <label className={label}>Completion date</label>
            <input type="date" value={f.completion_date} disabled={locked} onChange={e => set("completion_date", e.target.value)} className={inp} />
          </div>
          <div>
            <label className={label}>Homeowner name</label>
            <input value={f.homeowner_name} disabled={locked} onChange={e => set("homeowner_name", e.target.value)} className={inp} />
          </div>
          <div className="col-span-2">
            <label className={label}>Homeowner email</label>
            <input type="email" value={f.homeowner_email} disabled={locked} onChange={e => set("homeowner_email", e.target.value)} className={inp} />
          </div>
        </div>
      )}

      {error && <p className="text-sm text-danger mt-3">{error}</p>}
      {!locked && (
        <div className="mt-4 flex items-center gap-3">
          <button type="button" onClick={save} disabled={saving} className="bg-surface-hover hover:bg-line text-ink font-bold rounded-md px-4 py-2 text-sm disabled:opacity-50">
            {saving ? "Saving..." : "Save scheme details"}
          </button>
          {saved && <span className="text-xs text-accent-ink">Saved</span>}
        </div>
      )}
    </div>
  )
}
