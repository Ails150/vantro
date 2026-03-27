"use client"
import { useState, useEffect } from "react"

interface Props { teamMembers: any[] }

function getWeekRange(offset = 0) {
  const now = new Date()
  const monday = new Date(now)
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7) + offset * 7)
  monday.setHours(0, 0, 0, 0)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  sunday.setHours(23, 59, 59, 999)
  return { from: monday.toISOString(), to: sunday.toISOString() }
}

function getMonthRange() {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth(), 1)
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
  return { from: from.toISOString(), to: to.toISOString() }
}

export default function PayrollTab({ teamMembers }: Props) {
  const installers = teamMembers.filter((m: any) => m.role === "installer")
  const [mode, setMode] = useState("this_week")
  const [customFrom, setCustomFrom] = useState("")
  const [customTo, setCustomTo] = useState("")
  const [signins, setSignins] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [expandedId, setExpandedId] = useState<string|null>(null)
  const [editingSignin, setEditingSignin] = useState<string|null>(null)
  const [editSigninTime, setEditSigninTime] = useState("")
  const [editSignoutTime, setEditSignoutTime] = useState("")
  const [editSaving, setEditSaving] = useState(false)

  function getRange() {
    if (mode === "this_week") return getWeekRange(0)
    if (mode === "last_week") return getWeekRange(-1)
    if (mode === "this_month") return getMonthRange()
    if (mode === "custom" && customFrom && customTo) {
      return { from: new Date(customFrom).toISOString(), to: new Date(customTo + "T23:59:59").toISOString() }
    }
    return null
  }

  async function fetchPayroll() {
    const range = getRange()
    if (!range) return
    setLoading(true)
    try {
      const res = await fetch("/api/payroll?from=" + encodeURIComponent(range.from) + "&to=" + encodeURIComponent(range.to))
      const data = await res.json()
      setSignins(data.signins || [])
    } catch(e) {}
    setLoading(false)
  }

  useEffect(() => { fetchPayroll() }, [mode, customFrom, customTo])

  async function saveSigninEdit(signinId: string) {
    setEditSaving(true)
    await fetch("/api/payroll/edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signinId, signed_in_at: editSigninTime, signed_out_at: editSignoutTime || null })
    })
    setEditingSignin(null)
    setEditSaving(false)
    fetchPayroll()
  }

  function getInstallerSignins(id: string) {
    return signins.filter((s: any) => s.user_id === id)
  }

  function getTotalHours(ss: any[]) {
    return ss.reduce((acc: number, s: any) => {
      if (s.signed_in_at && s.signed_out_at) return acc + (new Date(s.signed_out_at).getTime() - new Date(s.signed_in_at).getTime()) / 3600000
      return acc
    }, 0)
  }

  function getByDay(ss: any[]) {
    const days: Record<string, number> = {}
    ss.forEach((s: any) => {
      if (!s.signed_in_at || !s.signed_out_at) return
      const day = new Date(s.signed_in_at).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" })
      days[day] = (days[day] || 0) + (new Date(s.signed_out_at).getTime() - new Date(s.signed_in_at).getTime()) / 3600000
    })
    return days
  }

  function getByJob(ss: any[]) {
    const jobs: Record<string, number> = {}
    ss.forEach((s: any) => {
      if (!s.signed_in_at || !s.signed_out_at) return
      const name = s.jobs?.name || "Unknown"
      jobs[name] = (jobs[name] || 0) + (new Date(s.signed_out_at).getTime() - new Date(s.signed_in_at).getTime()) / 3600000
    })
    return jobs
  }

  const sub = "text-gray-500"
  const card = "bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm"

  return (
    <div className="space-y-5">
      <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
        <div className="flex flex-wrap gap-3 items-center">
          {[
            { id: "this_week", label: "This week" },
            { id: "last_week", label: "Last week" },
            { id: "this_month", label: "This month" },
            { id: "custom", label: "Custom" },
          ].map((opt: any) => (
            <button key={opt.id} onClick={() => setMode(opt.id)}
              className={"px-4 py-2 rounded-xl text-sm font-semibold transition-colors " + (mode === opt.id ? "bg-teal-400 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}>
              {opt.label}
            </button>
          ))}
          {mode === "custom" && (
            <div className="flex items-center gap-2">
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-teal-400"/>
              <span className={sub}>to</span>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-teal-400"/>
            </div>
          )}
          {loading && <span className={"text-sm " + sub + " ml-auto"}>Loading...</span>}
        </div>
      </div>

      <div className={card}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <span className="font-semibold">Hours by installer</span>
        </div>
        {installers.length === 0 ? <div className={"px-6 py-16 text-center " + sub}>No installers yet</div>
        : installers.map((m: any) => {
          const ms = getInstallerSignins(m.id)
          const total = getTotalHours(ms)
          const byDay = getByDay(ms)
          const byJob = getByJob(ms)
          const isExpanded = expandedId === m.id
          return (
            <div key={m.id} className="border-b border-gray-50 last:border-0">
              <div className="flex items-center gap-4 px-6 py-5 cursor-pointer hover:bg-gray-50" onClick={() => setExpandedId(isExpanded ? null : m.id)}>
                <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center font-bold flex-shrink-0">{m.initials}</div>
                <div className="flex-1">
                  <div className="font-semibold">{m.name}</div>
                  <div className={"text-sm " + sub}>{m.email}</div>
                </div>
                <div className="text-right mr-3">
                  <div className="text-2xl font-bold text-teal-500">{total.toFixed(1)}h</div>
                  <div className={"text-xs " + sub}>{ms.length} session{ms.length !== 1 ? "s" : ""}</div>
                </div>
                <span className={"text-xs " + sub}>{isExpanded ? "▲" : "▼"}</span>
              </div>
              {isExpanded && (
                <div className="px-6 pb-5 grid grid-cols-2 gap-4">
                  <div className="bg-gray-50 rounded-xl p-4">
                    <div className="text-sm font-semibold mb-3">Sessions</div>
                    {ms.length === 0 ? <div className={"text-sm " + sub}>No sessions</div>
                    : ms.map((s: any) => (
                      <div key={s.id} className="py-2 border-b border-gray-100 last:border-0">
                        {editingSignin === s.id ? (
                          <div className="space-y-2">
                            <div className="flex gap-2 items-center">
                              <span className="text-xs text-gray-500 w-16">Sign in</span>
                              <input type="datetime-local" value={editSigninTime} onChange={e => setEditSigninTime(e.target.value)} className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:border-teal-400"/>
                            </div>
                            <div className="flex gap-2 items-center">
                              <span className="text-xs text-gray-500 w-16">Sign out</span>
                              <input type="datetime-local" value={editSignoutTime} onChange={e => setEditSignoutTime(e.target.value)} className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:border-teal-400"/>
                            </div>
                            <div className="flex gap-2">
                              <button onClick={() => saveSigninEdit(s.id)} disabled={editSaving} className="text-xs bg-teal-400 text-white rounded-lg px-3 py-1 font-medium">{editSaving ? "Saving..." : "Save"}</button>
                              <button onClick={() => setEditingSignin(null)} className="text-xs bg-gray-100 text-gray-600 rounded-lg px-3 py-1">Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex justify-between items-center">
                            <div>
                              <div className="text-xs text-gray-600">{new Date(s.signed_in_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
                              <div className="text-xs text-gray-400">{s.signed_out_at ? "Out: " + new Date(s.signed_out_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "Not signed out"}</div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold">{s.signed_out_at ? ((new Date(s.signed_out_at).getTime() - new Date(s.signed_in_at).getTime()) / 3600000).toFixed(1) + "h" : "-"}</span>
                              <button onClick={() => { setEditingSignin(s.id); setEditSigninTime(s.signed_in_at.slice(0,16)); setEditSignoutTime(s.signed_out_at ? s.signed_out_at.slice(0,16) : "") }} className="text-xs text-gray-400 hover:text-teal-600 border border-gray-200 rounded-lg px-2 py-0.5">Edit</button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="bg-gray-50 rounded-xl p-4">
                    <div className="text-sm font-semibold mb-3">By job</div>
                    {Object.keys(byJob).length === 0 ? <div className={"text-sm " + sub}>No data</div>
                    : Object.entries(byJob).map(([job, hrs]) => (
                      <div key={job} className="flex justify-between py-1.5 border-b border-gray-100 last:border-0">
                        <span className="text-sm text-gray-600 truncate mr-2">{job}</span>
                        <span className="text-sm font-semibold flex-shrink-0">{(hrs as number).toFixed(1)}h</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
