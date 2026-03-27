"use client"
import { useState, useEffect } from "react"

export default function DefectsTab() {
  const [defects, setDefects] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState("open")
  const [resolving, setResolving] = useState<string|null>(null)
  const [resolutionNote, setResolutionNote] = useState("")

  useEffect(() => { fetchDefects() }, [])

  async function fetchDefects() {
    setLoading(true)
    const res = await fetch("/api/defects")
    const data = await res.json()
    setDefects(data.defects || [])
    setLoading(false)
  }

  async function resolve(defectId: string) {
    await fetch("/api/defects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "resolve", defectId, resolutionNote })
    })
    setResolving(null)
    setResolutionNote("")
    fetchDefects()
  }

  async function reopen(defectId: string) {
    await fetch("/api/defects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reopen", defectId })
    })
    fetchDefects()
  }

  const filtered = defects.filter((d: any) => filter === "all" || d.status === filter)
  const card = "bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm"
  const sub = "text-gray-500"

  if (loading) return <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-teal-400 border-t-transparent rounded-full animate-spin"/></div>

  return (
    <div className="space-y-5">
      <div className="flex gap-2 flex-wrap">
        {[
          { id: "open", label: "Open" },
          { id: "resolved", label: "Resolved" },
          { id: "all", label: "All" },
        ].map((f: any) => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className={"px-4 py-2 rounded-xl text-sm font-semibold transition-colors " + (filter === f.id ? "bg-teal-400 text-white" : "bg-white border border-gray-200 text-gray-600 hover:border-teal-300")}>
            {f.label}
            <span className="ml-2 text-xs opacity-70">{f.id === "all" ? defects.length : defects.filter((d: any) => d.status === f.id).length}</span>
          </button>
        ))}
      </div>

      <div className={card}>
        {filtered.length === 0 ? (
          <div className={"px-6 py-16 text-center " + sub}>No {filter} defects</div>
        ) : filtered.map((d: any) => (
          <div key={d.id} className="px-6 py-5 border-b border-gray-50 last:border-0">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className={"text-xs px-2 py-1 rounded-full font-medium " + (d.severity === "critical" ? "bg-red-50 text-red-600 border border-red-200" : d.severity === "major" ? "bg-amber-50 text-amber-600 border border-amber-200" : "bg-gray-100 text-gray-600")}>
                    {d.severity}
                  </span>
                  <span className={"text-xs px-2 py-1 rounded-full font-medium " + (d.status === "resolved" ? "bg-teal-50 text-teal-600 border border-teal-200" : "bg-red-50 text-red-500 border border-red-200")}>
                    {d.status}
                  </span>
                  <span className={"text-xs " + sub}>{d.users?.name} — {d.jobs?.name}</span>
                </div>
                <p className="text-sm font-medium mb-1">{d.description}</p>
                {d.photo_url && (
                  <a href={d.photo_url} target="_blank" rel="noreferrer">
                    <img src={d.photo_url} alt="Defect" className="w-48 h-32 object-cover rounded-xl mt-2 hover:opacity-90 cursor-pointer"/>
                  </a>
                )}
                {d.resolution_note && <p className={"text-xs mt-2 " + sub}>Resolution: {d.resolution_note}</p>}
                <p className={"text-xs mt-1 " + sub}>{new Date(d.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
              </div>
              <div className="flex-shrink-0">
                {d.status === "open" ? (
                  resolving === d.id ? (
                    <div className="space-y-2 w-48">
                      <input value={resolutionNote} onChange={e => setResolutionNote(e.target.value)} placeholder="Resolution note..." className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-teal-400"/>
                      <div className="flex gap-2">
                        <button onClick={() => resolve(d.id)} className="flex-1 bg-teal-400 text-white rounded-lg px-3 py-1.5 text-xs font-semibold">Resolve</button>
                        <button onClick={() => setResolving(null)} className="bg-gray-100 text-gray-600 rounded-lg px-3 py-1.5 text-xs">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => { setResolving(d.id); setResolutionNote("") }} className="bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 rounded-xl px-4 py-2 text-sm font-semibold">
                      Resolve
                    </button>
                  )
                ) : (
                  <button onClick={() => reopen(d.id)} className="bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl px-4 py-2 text-sm">
                    Reopen
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
