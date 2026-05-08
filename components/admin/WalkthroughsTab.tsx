"use client"
import { useEffect, useState } from "react"

type Clip = {
  id: string
  sequence_number: number
  duration_seconds: number | null
  transcript: string | null
  stream_video_id: string
}

type Walkthrough = {
  id: string
  recorded_at: string
  duration_seconds: number | null
  ai_summary: string | null
  ai_sections: Array<{ heading: string; bullets: string[]; clip_references?: number[] }> | null
  ai_themes: string[] | null
  ai_sentiment: string | null
  ai_flags: Array<{ type: string; description: string; clip_reference?: number }> | null
  approval_status: "pending" | "approved" | "rejected"
  processing_status: "pending" | "processing" | "ready" | "failed"
  processing_error: string | null
  approved_at: string | null
  rejected_reason: string | null
  job: { id: string; name: string; address: string | null } | null
  installer: { id: string; name: string } | null
  approver: { id: string; name: string } | null
  clips: Clip[]
}

const SENTIMENT_COLOR: Record<string, string> = {
  confident: "bg-emerald-50 text-emerald-700 border-emerald-200",
  neutral: "bg-gray-50 text-gray-700 border-gray-200",
  uncertain: "bg-amber-50 text-amber-700 border-amber-200",
  escalated: "bg-red-50 text-red-700 border-red-200",
}

const FLAG_COLOR: Record<string, string> = {
  delay: "bg-amber-50 text-amber-700 border-amber-200",
  defect: "bg-red-50 text-red-700 border-red-200",
  supply_issue: "bg-orange-50 text-orange-700 border-orange-200",
  safety: "bg-red-100 text-red-800 border-red-300",
  quality_concern: "bg-yellow-50 text-yellow-700 border-yellow-200",
}

export default function WalkthroughsTab() {
  const [walkthroughs, setWalkthroughs] = useState<Walkthrough[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<"all" | "today" | "7d" | "30d">("7d")
  const [status, setStatus] = useState<"all" | "pending" | "approved" | "rejected">("all")
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState("")

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`/api/walkthroughs?filter=${filter}&status=${status}`, {
        credentials: "include",
      })
      const data = await res.json()
      setWalkthroughs(data.walkthroughs || [])
    } catch (e) {
      console.error("Failed to load walkthroughs", e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [filter, status])

  // Auto-poll while any walkthrough is still processing
  useEffect(() => {
    const hasProcessing = walkthroughs.some(w =>
      w.processing_status === "processing" || w.processing_status === "pending"
    )
    if (!hasProcessing) return
    const interval = setInterval(() => load(), 8000)
    return () => clearInterval(interval)
  }, [walkthroughs])

  function toggleExpanded(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function approve(id: string) {
    if (!confirm("Approve this walkthrough? It will appear in client and compliance audit reports.")) return
    const res = await fetch(`/api/walkthroughs/${id}/approve`, {
      method: "POST",
      credentials: "include",
    })
    if (res.ok) load()
    else alert("Approval failed")
  }

  async function reject(id: string) {
    if (!rejectReason.trim()) {
      alert("Please add a reason for rejection")
      return
    }
    const res = await fetch(`/api/walkthroughs/${id}/reject`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: rejectReason.trim() }),
    })
    if (res.ok) {
      setRejectingId(null)
      setRejectReason("")
      load()
    } else {
      alert("Rejection failed")
    }
  }

  const filterChips: Array<{ id: typeof filter; label: string }> = [
    { id: "today", label: "Today" },
    { id: "7d", label: "Last 7d" },
    { id: "30d", label: "Last 30d" },
    { id: "all", label: "All time" },
  ]

  const statusChips: Array<{ id: typeof status; label: string; count?: number }> = [
    { id: "all", label: "All" },
    { id: "pending", label: "Pending", count: walkthroughs.filter(w => w.approval_status === "pending").length },
    { id: "approved", label: "Approved" },
    { id: "rejected", label: "Rejected" },
  ]

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
        <div className="flex items-start justify-between flex-wrap gap-4 mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Walk & Talks</h2>
            <p className="text-sm text-gray-500 mt-1">
              Voice-narrated site walk & talks with AI-structured documentation. Approved walkthroughs appear in client and compliance audit reports.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-3">
          {filterChips.map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={
                "text-xs px-3 py-1.5 rounded-full border transition-colors " +
                (filter === f.id
                  ? "bg-teal-500 text-white border-teal-500 font-semibold"
                  : "bg-white text-gray-700 border-gray-200 hover:border-gray-300")
              }
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          {statusChips.map(s => (
            <button
              key={s.id}
              onClick={() => setStatus(s.id)}
              className={
                "text-xs px-3 py-1.5 rounded-full border transition-colors " +
                (status === s.id
                  ? "bg-purple-500 text-white border-purple-500 font-semibold"
                  : "bg-white text-gray-700 border-gray-200 hover:border-gray-300")
              }
            >
              {s.label}
              {s.count != null && s.count > 0 && (
                <span className="ml-1 opacity-80">({s.count})</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center text-gray-500">
          Loading walkthroughs...
        </div>
      ) : walkthroughs.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center text-gray-500">
          <div className="text-4xl mb-2">🎙️</div>
          <div className="font-semibold text-gray-700">No walk & talks yet</div>
          <div className="text-sm mt-1">
            Installers can record voice-narrated walk & talks from the mobile app.
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {walkthroughs.map(w => {
            const isExpanded = expanded.has(w.id)
            const recorded = new Date(w.recorded_at)
            const statusBadge =
              w.approval_status === "approved"
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : w.approval_status === "rejected"
                ? "bg-red-50 text-red-700 border-red-200"
                : "bg-amber-50 text-amber-700 border-amber-200"

            return (
              <div key={w.id} className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
                <div className="p-5">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex-1 min-w-[260px]">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${statusBadge}`}>
                          {w.approval_status.toUpperCase()}
                        </span>
                        {w.processing_status === "processing" && (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full border bg-purple-50 text-purple-700 border-purple-200 inline-flex items-center gap-1">
                            <span className="inline-block w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
                            Analysing
                          </span>
                        )}
                        {w.processing_status === "pending" && (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full border bg-gray-50 text-gray-700 border-gray-200">
                            Queued
                          </span>
                        )}
                        {w.processing_status === "failed" && (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full border bg-red-50 text-red-700 border-red-200">
                            ⚠ Processing failed
                          </span>
                        )}
                        {w.ai_sentiment && (
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${SENTIMENT_COLOR[w.ai_sentiment] || ""}`}>
                            {w.ai_sentiment}
                          </span>
                        )}
                        {(w.ai_flags || []).map((f, i) => (
                          <span key={i} className={`text-xs font-medium px-2 py-0.5 rounded-full border ${FLAG_COLOR[f.type] || "bg-gray-50 text-gray-700 border-gray-200"}`}>
                            {f.type.replace(/_/g, " ")}
                          </span>
                        ))}
                      </div>
                      <div className="font-semibold text-gray-900">
                        {w.job?.name || "Unknown job"}
                      </div>
                      <div className="text-sm text-gray-500">
                        {w.installer?.name || "Unknown installer"} · {recorded.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} · {recorded.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                        {w.clips?.length > 0 && ` · ${w.clips.length} clip${w.clips.length === 1 ? "" : "s"}`}
                      </div>
                    </div>

                    {w.approval_status === "pending" && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => approve(w.id)}
                          className="text-xs bg-emerald-500 hover:bg-emerald-600 text-white font-semibold px-3 py-1.5 rounded-full transition-colors"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => setRejectingId(w.id)}
                          className="text-xs bg-red-50 hover:bg-red-100 text-red-700 font-semibold px-3 py-1.5 rounded-full border border-red-200 transition-colors"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>

                  {w.ai_summary && (
                    <p className="text-sm text-gray-700 mt-3">{w.ai_summary}</p>
                  )}

                  {(w.ai_themes || []).length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {w.ai_themes!.map((t, i) => (
                        <span key={i} className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full">
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}

                  {rejectingId === w.id && (
                    <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl">
                      <div className="text-sm font-semibold text-red-900 mb-2">Rejection reason</div>
                      <textarea
                        value={rejectReason}
                        onChange={e => setRejectReason(e.target.value)}
                        placeholder="Why is this walkthrough being rejected? (e.g. inaudible, off-topic, duplicate)"
                        className="w-full bg-white border border-red-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-400"
                        rows={3}
                      />
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={() => reject(w.id)}
                          className="text-xs bg-red-500 hover:bg-red-600 text-white font-semibold px-3 py-1.5 rounded-full"
                        >
                          Confirm rejection
                        </button>
                        <button
                          onClick={() => { setRejectingId(null); setRejectReason("") }}
                          className="text-xs bg-white text-gray-700 px-3 py-1.5 rounded-full border border-gray-200"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {w.processing_status === "failed" && w.processing_error && (
                    <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-xl text-sm">
                      <span className="font-semibold text-red-900">AI Processing failed:</span>{" "}
                      <span className="text-red-800">{w.processing_error}</span>
                      <div className="text-xs text-red-700 mt-1">Auto-retry will run within 5 minutes.</div>
                    </div>
                  )}

                  {w.rejected_reason && w.approval_status === "rejected" && (
                    <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-xl text-sm">
                      <span className="font-semibold text-red-900">Rejected:</span>{" "}
                      <span className="text-red-800">{w.rejected_reason}</span>
                      {w.approver?.name && <div className="text-xs text-red-700 mt-1">By {w.approver.name}</div>}
                    </div>
                  )}

                  <button
                    onClick={() => toggleExpanded(w.id)}
                    className="mt-3 text-xs text-teal-600 hover:text-teal-700 font-semibold"
                  >
                    {isExpanded ? "Hide details ↑" : "Show details ↓"}
                  </button>
                </div>

                {isExpanded && (
                  <div className="border-t border-gray-100 bg-gray-50 p-5 space-y-4">
                    {(w.ai_sections || []).map((s, i) => (
                      <div key={i} className="bg-white p-4 rounded-xl border border-gray-200">
                        <div className="font-semibold text-gray-900 mb-2">{s.heading}</div>
                        <ul className="space-y-1 list-disc list-inside text-sm text-gray-700">
                          {s.bullets.map((b, j) => <li key={j}>{b}</li>)}
                        </ul>
                        {(s.clip_references || []).length > 0 && (
                          <div className="text-xs text-gray-500 mt-2">
                            Source: {s.clip_references!.map(n => `Clip ${n}`).join(", ")}
                          </div>
                        )}
                      </div>
                    ))}

                    {(w.ai_flags || []).length > 0 && (
                      <div>
                        <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">Flags</div>
                        <div className="space-y-2">
                          {w.ai_flags!.map((f, i) => (
                            <div key={i} className={`p-3 rounded-xl border text-sm ${FLAG_COLOR[f.type] || "bg-gray-50 border-gray-200"}`}>
                              <div className="font-semibold capitalize">{f.type.replace(/_/g, " ")}</div>
                              <div className="mt-0.5">{f.description}</div>
                              {f.clip_reference && <div className="text-xs opacity-75 mt-1">Clip {f.clip_reference}</div>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {(w.clips || []).length > 0 && (
                      <div>
                        <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">Clips ({w.clips.length})</div>
                        <div className="space-y-2">
                          {w.clips
                            .sort((a, b) => a.sequence_number - b.sequence_number)
                            .map(c => {
                              const isRealStream = c.stream_video_id && !c.stream_video_id.startsWith("apx-test") && !c.stream_video_id.startsWith("test-")
                              return (
                              <div key={c.id} className="bg-white rounded-xl border border-gray-200 text-sm overflow-hidden">
                                {isRealStream && (
                                  <div className="aspect-video bg-black">
                                    <iframe
                                      src={`https://customer-6416opuz33lyk78q.cloudflarestream.com/${c.stream_video_id}/iframe`}
                                      className="w-full h-full"
                                      allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
                                      allowFullScreen
                                    />
                                  </div>
                                )}
                                <div className="p-3">
                                  <div className="text-xs font-semibold text-gray-500 mb-1">
                                    Clip {c.sequence_number} · {c.duration_seconds}s
                                    {!isRealStream && <span className="ml-2 text-gray-400">(test data — no video)</span>}
                                  </div>
                                  <div className="text-gray-700">{c.transcript || "(no transcript)"}</div>
                                </div>
                              </div>
                              )
                            })}
                        </div>
                      </div>
                    )}

                    {w.approver?.name && w.approval_status === "approved" && (
                      <div className="text-xs text-emerald-700">
                        Approved by {w.approver.name} on {w.approved_at ? new Date(w.approved_at).toLocaleDateString("en-GB") : "?"}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
