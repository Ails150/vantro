"use client"

import { useEffect, useState } from "react"
import { formatRate, type RateType } from "@/lib/subcontractors-utils"

interface Subcontractor {
  id: string
  name: string
  contact_name: string | null
  contact_phone: string | null
  contact_email: string | null
  address: string | null
  rate_type: RateType
  rate_amount: number | null
  rate_currency: string
  notes: string | null
  active: boolean
  active_assignment_count: number
  created_at: string
  insurance_provider: string | null
  insurance_policy_no: string | null
  insurance_expiry: string | null
  liability_cover_amount: number | null
  vat_number: string | null
  utr_number: string | null
  cis_registered: boolean
  rams_on_file: boolean
  portal_enabled: boolean
}

interface CrewMember {
  id: string
  name: string
  email: string
  role: string
  is_active: boolean
}

const RATE_TYPE_OPTIONS: { value: RateType; label: string }[] = [
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "per_job", label: "Per job" },
]

export function SubcontractorsSection() {
  const [subs, setSubs] = useState<Subcontractor[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<Subcontractor | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState("")
  const [showCompliance, setShowCompliance] = useState(false)
  const [selectedSubId, setSelectedSubId] = useState<string | null>(null)

  const [form, setForm] = useState({
    name: "", contact_name: "", contact_phone: "", contact_email: "", address: "",
    rate_type: "daily" as RateType, rate_amount: "", notes: "", active: true,
    insurance_provider: "", insurance_policy_no: "", insurance_expiry: "",
    liability_cover_amount: "", vat_number: "", utr_number: "",
    cis_registered: false, rams_on_file: false, portal_enabled: false,
  })

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/subcontractors")
      const data = await res.json()
      setSubs(data.subcontractors || [])
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function resetForm() {
    setForm({
      name: "", contact_name: "", contact_phone: "", contact_email: "", address: "",
      rate_type: "daily", rate_amount: "", notes: "", active: true,
      insurance_provider: "", insurance_policy_no: "", insurance_expiry: "",
      liability_cover_amount: "", vat_number: "", utr_number: "",
      cis_registered: false, rams_on_file: false, portal_enabled: false,
    })
    setFormError("")
    setShowCompliance(false)
  }

  function openAdd() { resetForm(); setEditing(null); setShowAdd(true) }

  function openEdit(sub: Subcontractor) {
    setForm({
      name: sub.name,
      contact_name: sub.contact_name || "",
      contact_phone: sub.contact_phone || "",
      contact_email: sub.contact_email || "",
      address: sub.address || "",
      rate_type: sub.rate_type,
      rate_amount: sub.rate_amount?.toString() || "",
      notes: sub.notes || "",
      active: sub.active,
      insurance_provider: sub.insurance_provider || "",
      insurance_policy_no: sub.insurance_policy_no || "",
      insurance_expiry: sub.insurance_expiry || "",
      liability_cover_amount: sub.liability_cover_amount?.toString() || "",
      vat_number: sub.vat_number || "",
      utr_number: sub.utr_number || "",
      cis_registered: !!sub.cis_registered,
      rams_on_file: !!sub.rams_on_file,
      portal_enabled: !!sub.portal_enabled,
    })
    setEditing(sub)
    setFormError("")
    const hasCompliance = !!(sub.insurance_provider || sub.insurance_policy_no || sub.insurance_expiry || sub.liability_cover_amount || sub.vat_number || sub.utr_number || sub.cis_registered || sub.rams_on_file)
    setShowCompliance(hasCompliance)
    setShowAdd(true)
  }

  async function save() {
    if (!form.name.trim()) { setFormError("Name is required"); return }
    setSaving(true); setFormError("")
    const payload = {
      ...form,
      name: form.name.trim(),
      rate_amount: form.rate_amount ? parseFloat(form.rate_amount) : null,
      liability_cover_amount: form.liability_cover_amount ? parseFloat(form.liability_cover_amount) : null,
      insurance_expiry: form.insurance_expiry || null,
    }
    try {
      const res = editing
        ? await fetch(`/api/admin/subcontractors/${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        : await fetch("/api/admin/subcontractors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      const data = await res.json()
      if (!res.ok) { setFormError(data.error || "Failed to save"); setSaving(false); return }
      setShowAdd(false); setEditing(null); resetForm(); await load()
    } catch (e) { setFormError("Network error") }
    setSaving(false)
  }

  async function toggleActive(sub: Subcontractor) {
    await fetch(`/api/admin/subcontractors/${sub.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !sub.active }),
    })
    await load()
  }

  if (loading) return <div className="text-sm text-gray-500 p-4">Loading subcontractors...</div>

  // ========================================================================
  // DETAIL VIEW - when a subcontractor is selected
  // ========================================================================
  if (selectedSubId) {
    const selectedSub = subs.find(s => s.id === selectedSubId)
    if (!selectedSub) {
      setSelectedSubId(null)
      return null
    }
    return <SubDetail sub={selectedSub} onBack={() => { setSelectedSubId(null); load() }} onEdit={() => openEdit(selectedSub)} editModal={showAdd && editing?.id === selectedSub.id ? renderEditModal() : null} />
  }

  // ========================================================================
  // LIST VIEW
  // ========================================================================
  const activeSubs = subs.filter(s => s.active)
  const inactiveSubs = subs.filter(s => !s.active)

  function renderEditModal() {
    if (!showAdd) return null
    return (
      <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => !saving && setShowAdd(false)}>
        <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
          <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
            <h3 className="font-semibold">{editing ? "Edit subcontractor" : "Add subcontractor"}</h3>
            <button type="button" onClick={() => !saving && setShowAdd(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <label className="text-xs font-semibold text-gray-700 uppercase block mb-1">Company name *</label>
              <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-teal-400" placeholder="Bob\'s Roofing Ltd" autoFocus/>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase block mb-1">Contact name</label>
                <input type="text" value={form.contact_name} onChange={e => setForm({ ...form, contact_name: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-teal-400" placeholder="Bob Smith"/>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase block mb-1">Phone</label>
                <input type="tel" value={form.contact_phone} onChange={e => setForm({ ...form, contact_phone: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-teal-400"/>
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700 uppercase block mb-1">Email</label>
              <input type="email" value={form.contact_email} onChange={e => setForm({ ...form, contact_email: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-teal-400"/>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700 uppercase block mb-1">Address</label>
              <input type="text" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-teal-400"/>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase block mb-1">Rate type *</label>
                <select value={form.rate_type} onChange={e => setForm({ ...form, rate_type: e.target.value as RateType })} className="w-full border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-teal-400">
                  {RATE_TYPE_OPTIONS.map(o => (<option key={o.value} value={o.value}>{o.label}</option>))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase block mb-1">Rate amount (£)</label>
                <input type="number" step="0.01" min="0" value={form.rate_amount} onChange={e => setForm({ ...form, rate_amount: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-teal-400" placeholder="180.00"/>
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700 uppercase block mb-1">Notes</label>
              <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={3} className="w-full border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-teal-400 resize-none"/>
            </div>
            <div className="border-t border-gray-100 pt-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={form.portal_enabled} onChange={e => setForm({ ...form, portal_enabled: e.target.checked })} className="w-4 h-4 rounded accent-teal-500"/>
                <div>
                  <div className="text-sm font-semibold text-gray-800">Crew portal access</div>
                  <div className="text-xs text-gray-500">Their installers can sign into the Vantro mobile app under this subcontractor</div>
                </div>
              </label>
            </div>
            <div className="border-t border-gray-100 pt-4">
              <button type="button" onClick={() => setShowCompliance(v => !v)} className="flex items-center justify-between w-full text-sm font-semibold text-gray-700 hover:text-gray-900">
                <span>Compliance &amp; insurance <span className="text-xs font-normal text-gray-400">(optional)</span></span>
                <span className="text-gray-400">{showCompliance ? "−" : "+"}</span>
              </button>
              {showCompliance && (
                <div className="mt-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="text-xs font-semibold text-gray-700 uppercase block mb-1">Insurance provider</label><input type="text" value={form.insurance_provider} onChange={e => setForm({ ...form, insurance_provider: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-teal-400"/></div>
                    <div><label className="text-xs font-semibold text-gray-700 uppercase block mb-1">Policy no.</label><input type="text" value={form.insurance_policy_no} onChange={e => setForm({ ...form, insurance_policy_no: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-teal-400"/></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="text-xs font-semibold text-gray-700 uppercase block mb-1">Insurance expiry</label><input type="date" value={form.insurance_expiry} onChange={e => setForm({ ...form, insurance_expiry: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-teal-400"/></div>
                    <div><label className="text-xs font-semibold text-gray-700 uppercase block mb-1">Liability cover (£)</label><input type="number" step="0.01" min="0" value={form.liability_cover_amount} onChange={e => setForm({ ...form, liability_cover_amount: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-teal-400" placeholder="1000000"/></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="text-xs font-semibold text-gray-700 uppercase block mb-1">VAT number</label><input type="text" value={form.vat_number} onChange={e => setForm({ ...form, vat_number: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-teal-400"/></div>
                    <div><label className="text-xs font-semibold text-gray-700 uppercase block mb-1">UTR</label><input type="text" value={form.utr_number} onChange={e => setForm({ ...form, utr_number: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-teal-400"/></div>
                  </div>
                  <div className="flex gap-4 pt-1">
                    <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={form.cis_registered} onChange={e => setForm({ ...form, cis_registered: e.target.checked })} className="w-4 h-4 rounded accent-teal-500"/>CIS registered</label>
                    <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={form.rams_on_file} onChange={e => setForm({ ...form, rams_on_file: e.target.checked })} className="w-4 h-4 rounded accent-teal-500"/>RAMS on file</label>
                  </div>
                </div>
              )}
            </div>
            {formError && (<div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{formError}</div>)}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={save} disabled={saving} className="flex-1 px-4 py-2.5 bg-teal-400 hover:bg-teal-500 text-white font-semibold rounded-xl disabled:opacity-50">{saving ? "Saving..." : editing ? "Save changes" : "Add subcontractor"}</button>
              <button type="button" onClick={() => !saving && setShowAdd(false)} className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl">Cancel</button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <div>
          <span className="font-semibold">Subcontractor companies</span>
          <span className="text-sm text-gray-500 ml-2">{activeSubs.length} active</span>
        </div>
        <button type="button" onClick={openAdd} className="px-4 py-2 bg-teal-400 hover:bg-teal-500 text-white text-sm font-semibold rounded-xl">+ Add subcontractor</button>
      </div>
      {subs.length === 0 ? (
        <div className="px-6 py-16 text-center text-gray-500">No subcontractors yet. Add a company you regularly hire labour from.</div>
      ) : (
        <div>
          {[...activeSubs, ...inactiveSubs].map(sub => (
            <div key={sub.id} className={"flex items-center gap-4 px-6 py-4 border-b border-gray-50 last:border-0 cursor-pointer hover:bg-gray-50 transition-colors " + (sub.active ? "" : "opacity-50")} onClick={() => setSelectedSubId(sub.id)}>
              <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center font-bold text-gray-700 flex-shrink-0">{sub.name.slice(0, 2).toUpperCase()}</div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold flex items-center gap-2">
                  {sub.name}
                  {sub.portal_enabled && (<span className="text-[10px] font-bold uppercase tracking-wide bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full">Portal</span>)}
                  {!sub.active && (<span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">Inactive</span>)}
                </div>
                <div className="text-sm text-gray-500 truncate">
                  {sub.contact_name && <span>{sub.contact_name}</span>}
                  {sub.contact_name && sub.contact_phone && <span> · </span>}
                  {sub.contact_phone && <span>{sub.contact_phone}</span>}
                </div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {sub.rate_amount ? formatRate(sub.rate_type, Number(sub.rate_amount), sub.rate_currency) : "Rate not set"}
                  <span className="mx-2">·</span>
                  {sub.active_assignment_count} active job{sub.active_assignment_count !== 1 ? "s" : ""}
                </div>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button type="button" onClick={e => { e.stopPropagation(); openEdit(sub) }} className="text-xs px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg">Edit</button>
                <button type="button" onClick={e => { e.stopPropagation(); toggleActive(sub) }} className={"text-xs px-3 py-1.5 rounded-lg " + (sub.active ? "bg-red-50 hover:bg-red-100 text-red-700" : "bg-emerald-50 hover:bg-emerald-100 text-emerald-700")}>{sub.active ? "Deactivate" : "Reactivate"}</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {renderEditModal()}
    </div>
  )
}

// ============================================================================
// SubDetail — drill-in view for one subcontractor
// ============================================================================
function SubDetail({ sub, onBack, onEdit }: { sub: Subcontractor; onBack: () => void; onEdit: () => void; editModal?: any }) {
  const [crew, setCrew] = useState<CrewMember[]>([])
  const [loadingCrew, setLoadingCrew] = useState(true)
  const [showAddCrew, setShowAddCrew] = useState(false)
  const [crewName, setCrewName] = useState("")
  const [crewEmail, setCrewEmail] = useState("")
  const [crewSaving, setCrewSaving] = useState(false)
  const [crewError, setCrewError] = useState("")

  async function loadCrew() {
    setLoadingCrew(true)
    try {
      const res = await fetch(`/api/admin/subcontractors/${sub.id}`)
      const data = await res.json()
      setCrew(data.crew_leads || [])
    } catch (e) { console.error(e) }
    setLoadingCrew(false)
  }

  useEffect(() => { loadCrew() }, [sub.id])

  async function addCrewMember() {
    if (!crewName.trim() || !crewEmail.trim()) { setCrewError("Name and email required"); return }
    setCrewSaving(true); setCrewError("")
    try {
      const res = await fetch(`/api/admin/subcontractors/${sub.id}/crew`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: crewName.trim(), email: crewEmail.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { setCrewError(data.error || "Failed to add"); setCrewSaving(false); return }
      setCrewName(""); setCrewEmail(""); setShowAddCrew(false)
      await loadCrew()
    } catch (e) { setCrewError("Network error") }
    setCrewSaving(false)
  }

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1">
        <span>←</span> Back to subcontractors
      </button>

      {/* Company header card */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center font-bold text-gray-700 text-lg">{sub.name.slice(0, 2).toUpperCase()}</div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-semibold">{sub.name}</h2>
                {sub.portal_enabled && (<span className="text-[10px] font-bold uppercase tracking-wide bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full">Portal</span>)}
                {!sub.active && (<span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">Inactive</span>)}
              </div>
              <div className="text-sm text-gray-500 mt-1">
                {sub.contact_name && <span>{sub.contact_name}</span>}
                {sub.contact_name && sub.contact_phone && <span> · </span>}
                {sub.contact_phone && <span>{sub.contact_phone}</span>}
                {(sub.contact_name || sub.contact_phone) && sub.contact_email && <span> · </span>}
                {sub.contact_email && <span>{sub.contact_email}</span>}
              </div>
              <div className="text-xs text-gray-400 mt-1">
                {sub.rate_amount ? formatRate(sub.rate_type, Number(sub.rate_amount), sub.rate_currency) : "Rate not set"}
                <span className="mx-2">·</span>
                {sub.active_assignment_count} active job{sub.active_assignment_count !== 1 ? "s" : ""}
              </div>
            </div>
          </div>
          <button onClick={onEdit} className="text-xs px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg">Edit details</button>
        </div>
      </div>

      {/* Crew members card */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <span className="font-semibold">Crew members</span>
            <span className="text-sm text-gray-500 ml-2">{crew.length} {crew.length === 1 ? "person" : "people"}</span>
          </div>
          {sub.portal_enabled ? (
            <button onClick={() => { setShowAddCrew(true); setCrewError("") }} className="px-4 py-2 bg-teal-400 hover:bg-teal-500 text-white text-sm font-semibold rounded-xl">+ Add crew member</button>
          ) : (
            <span className="text-xs text-gray-400">Enable Crew portal access to add members</span>
          )}
        </div>

        {showAddCrew && (
          <div className="p-6 bg-teal-50/50 border-b border-gray-100 space-y-3">
            <h3 className="font-semibold text-sm">New crew member for {sub.name}</h3>
            <p className="text-xs text-gray-500">They will receive an email invite with app download links to set up their PIN.</p>
            <input value={crewName} onChange={e => setCrewName(e.target.value)} placeholder="Full name" className="w-full border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-teal-400" autoFocus/>
            <input value={crewEmail} onChange={e => setCrewEmail(e.target.value)} placeholder="Email address" type="email" className="w-full border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-teal-400"/>
            {crewError && <p className="text-sm text-red-600">{crewError}</p>}
            <div className="flex gap-2">
              <button onClick={addCrewMember} disabled={crewSaving} className="px-4 py-2 bg-teal-400 hover:bg-teal-500 text-white text-sm font-semibold rounded-xl disabled:opacity-50">{crewSaving ? "Saving..." : "Save and send invite"}</button>
              <button onClick={() => { setShowAddCrew(false); setCrewName(""); setCrewEmail(""); setCrewError("") }} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold rounded-xl">Cancel</button>
            </div>
          </div>
        )}

        {loadingCrew ? (
          <div className="px-6 py-8 text-sm text-gray-500">Loading crew...</div>
        ) : crew.length === 0 ? (
          <div className="px-6 py-12 text-center text-gray-500 text-sm">
            {sub.portal_enabled ? "No crew members yet. Add the first one above." : "Enable Crew portal access first, then add members."}
          </div>
        ) : (
          <div>
            {crew.map(m => (
              <div key={m.id} className="flex items-center gap-4 px-6 py-3 border-b border-gray-50 last:border-0">
                <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center font-bold text-gray-700 text-sm">{m.name.slice(0, 2).toUpperCase()}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{m.name}</div>
                  <div className="text-xs text-gray-500 truncate">{m.email}</div>
                </div>
                <div className="text-xs text-gray-400 capitalize">{m.role}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
