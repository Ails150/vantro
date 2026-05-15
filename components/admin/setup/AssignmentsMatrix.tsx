"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

type Job = { id: string; name: string; address: string }
type TeamMember = { id: string; name: string; role: string }
type Assignment = { job_id: string; user_id: string }

export default function AssignmentsMatrix() {
  const router = useRouter()
  const [jobs, setJobs] = useState<Job[]>([])
  const [team, setTeam] = useState<TeamMember[]>([])
  const [original, setOriginal] = useState<Set<string>>(new Set())
  const [current, setCurrent] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function key(jobId: string, userId: string) {
    return `${jobId}::${userId}`
  }

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/assignments-matrix")
      const data = await res.json()
      setJobs(data.jobs || [])
      setTeam(data.team || [])
      const set = new Set<string>((data.assignments || []).map((a: Assignment) => key(a.job_id, a.user_id)))
      setOriginal(new Set(set))
      setCurrent(set)
    } catch (e: any) {
      setError("Could not load data")
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function toggle(jobId: string, userId: string) {
    setCurrent(prev => {
      const next = new Set(prev)
      const k = key(jobId, userId)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  function assignAll() {
    setCurrent(() => {
      const next = new Set<string>()
      for (const j of jobs) for (const m of team) next.add(key(j.id, m.id))
      return next
    })
  }

  function clearAll() {
    setCurrent(new Set())
  }

  function assignJob(jobId: string) {
    setCurrent(prev => {
      const next = new Set(prev)
      for (const m of team) next.add(key(jobId, m.id))
      return next
    })
  }

  function clearJob(jobId: string) {
    setCurrent(prev => {
      const next = new Set(prev)
      for (const m of team) next.delete(key(jobId, m.id))
      return next
    })
  }

  async function save() {
    setSaving(true)
    setError(null)
    const add: { job_id: string; user_id: string }[] = []
    const remove: { job_id: string; user_id: string }[] = []
    for (const k of current) {
      if (!original.has(k)) {
        const [j, u] = k.split("::")
        add.push({ job_id: j, user_id: u })
      }
    }
    for (const k of original) {
      if (!current.has(k)) {
        const [j, u] = k.split("::")
        remove.push({ job_id: j, user_id: u })
      }
    }
    try {
      const res = await fetch("/api/admin/assignments-matrix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ add, remove }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || "Save failed")
      }
      router.push("/admin/setup")
    } catch (e: any) {
      setError(e.message || "Save failed")
    }
    setSaving(false)
  }

  const changed = [...current].some(k => !original.has(k)) || [...original].some(k => !current.has(k))

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">Loading...</div>
  }

  if (jobs.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 px-4 py-12">
        <div className="max-w-2xl mx-auto bg-white border border-gray-200 rounded-2xl p-8 text-center">
          <p className="text-gray-700 mb-4">You need to add job sites before you can assign people.</p>
          <button onClick={() => router.push("/admin/setup")} className="px-4 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-xl text-sm font-medium">
            Back to setup
          </button>
        </div>
      </div>
    )
  }

  if (team.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 px-4 py-12">
        <div className="max-w-2xl mx-auto bg-white border border-gray-200 rounded-2xl p-8 text-center">
          <p className="text-gray-700 mb-4">You need to add team members before you can assign them.</p>
          <button onClick={() => router.push("/admin/setup")} className="px-4 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-xl text-sm font-medium">
            Back to setup
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <button onClick={() => router.push("/admin/setup")} className="text-sm text-gray-500 hover:text-gray-900 mb-2">
              ← Back to setup
            </button>
            <h1 className="text-2xl font-bold text-gray-900">Who works where</h1>
            <p className="text-sm text-gray-600 mt-1">
              Tick a cell to assign that person to that job. They&apos;ll only see jobs they&apos;re assigned to in the mobile app.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={assignAll} className="px-3 py-1.5 text-xs font-medium bg-white border border-gray-200 rounded-md hover:bg-gray-50">
              Assign all
            </button>
            <button onClick={clearAll} className="px-3 py-1.5 text-xs font-medium bg-white border border-gray-200 rounded-md hover:bg-gray-50">
              Clear all
            </button>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left py-3 px-4 font-medium text-gray-600 sticky left-0 bg-gray-50 z-10 min-w-[200px]">
                  Person
                </th>
                {jobs.map(j => (
                  <th key={j.id} className="text-center py-3 px-3 font-medium text-gray-600 min-w-[100px]">
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-xs">{j.name}</span>
                      <div className="flex gap-1">
                        <button onClick={() => assignJob(j.id)} className="text-[10px] text-teal-600 hover:underline">all</button>
                        <span className="text-gray-300">·</span>
                        <button onClick={() => clearJob(j.id)} className="text-[10px] text-gray-500 hover:underline">none</button>
                      </div>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {team.map(m => (
                <tr key={m.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                  <td className="py-3 px-4 sticky left-0 bg-white">
                    <div className="font-medium text-gray-900">{m.name}</div>
                    <div className="text-[11px] text-gray-500 capitalize">{m.role}</div>
                  </td>
                  {jobs.map(j => {
                    const isOn = current.has(key(j.id, m.id))
                    return (
                      <td key={j.id} className="text-center py-3 px-3">
                        <button
                          onClick={() => toggle(j.id, m.id)}
                          className={
                            "w-6 h-6 rounded border-2 transition-colors " +
                            (isOn ? "bg-teal-500 border-teal-500" : "bg-white border-gray-300 hover:border-teal-400")
                          }
                          aria-label={`Toggle ${m.name} on ${j.name}`}
                        >
                          {isOn && (
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="mx-auto">
                              <path d="M3 7l3 3 5-6" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          )}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 flex items-center justify-between sticky bottom-4">
          <div className="text-xs text-gray-500">
            {current.size} assignment{current.size !== 1 ? "s" : ""} · {jobs.length} jobs × {team.length} people
            {changed && <span className="text-amber-600 ml-2">(unsaved changes)</span>}
          </div>
          {error && <div className="text-sm text-red-600">{error}</div>}
          <button
            onClick={save}
            disabled={saving || !changed}
            className="px-6 py-2.5 bg-teal-500 hover:bg-teal-600 text-white font-medium rounded-xl disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save assignments"}
          </button>
        </div>
      </div>
    </div>
  )
}