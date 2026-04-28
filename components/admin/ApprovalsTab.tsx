"use client"
import { useState, useEffect } from "react"

interface Props { pendingQA: any[]; onRefresh: () => void }

export default function ApprovalsTab({ pendingQA, onRefresh }: Props) {
  const [approvals, setApprovals] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string|null>(null)
  const [processing, setProcessing] = useState<string|null>(null)

  useEffect(() => { fetchApprovals() }, [])

  async function fetchApprovals() {
    setLoading(true)
    const res = await fetch("/api/qa/approvals")
    const data = await res.json()
    setApprovals(data.approvals || [])
    setLoading(false)
  }

  async function handleApprove(approvalId: string) {
    setProcessing(approvalId)
    await fetch("/api/qa/approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approvalId, action: "approved" })
    })
    await fetchApprovals()
    onRefresh()
    setProcessing(null)
  }

  async function handleReject(approvalId: string) {
    const note = window.prompt("Rejection reason:")
    if (!note) return
    setProcessing(approvalId)
    await fetch("/api/qa/approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approvalId, action: "rejected", note })
    })
    await fetchApprovals()
    onRefresh()
    setProcessing(null)
  }

  const sub = "text-gray-500"
  const card = "bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm"

  if (loading) return <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-teal-400 border-t-transparent rounded-full animate-spin"/></div>

  const pending = approvals.filter((a: any) => a.status === "pending")
  const reviewed = approvals.filter((a: any) => a.status !== "pending")

  return (
    <div className="space-y-5">
      <div className={card}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <span className="font-semibold">Awaiting approval</span>
          {pending.length > 0 && <span className="text-xs bg-amber-50 text-amber-600 border border-amber-200 px-2 py-1 rounded-full font-medium">{pending.length} pending</span>}
        </div>
        {pending.length === 0 ? (
          <div className={"px-6 py-16 text-center " + sub}>Nothing waiting for approval</div>
        ) : pending.map((qa: any) => (
          <div key={qa.id} className="border-b border-gray-50 last:border-0">
            <div className="px-6 py-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-9 h-9 rounded-full bg-teal-50 flex items-center justify-center text-sm font-bold text-teal-600 flex-shrink-0">{qa.users?.initials || "?"}</div>
                    <div>
                      <div className="font-semibold">{qa.users?.name}</div>
                      <div className={"text-sm " + sub}>{qa.jobs?.name} — {qa.jobs?.address}</div>
                    </div>
                  </div>
                  <div className={"text-xs " + sub}>Submitted {new Date(qa.submitted_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button onClick={() => setExpanded(expanded === qa.id ? null : qa.id)} className="text-sm border border-gray-200 text-gray-600 hover:border-teal-300 hover:text-teal-600 rounded-xl px-3 py-2">
                    {expanded === qa.id ? "Hide" : "View QA"}
                  </button>
                  <button onClick={() => handleApprove(qa.id)} disabled={processing === qa.id} className="bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50">Approve</button>
                  <button onClick={() => handleReject(qa.id)} disabled={processing === qa.id} className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50">Reject</button>
                </div>
              </div>
            </div>
            {expanded === qa.id && qa.submissions && (
              <div className="px-6 pb-5 bg-gray-50 border-t border-gray-100">
                <div className="space-y-3 pt-4">
                  {qa.submissions.map((sub: any) => (
                    <div key={sub.id} className="bg-white border border-gray-200 rounded-xl p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="font-medium text-sm">{sub.checklist_items?.label}</div>
                          <div className={"text-xs text-gray-500 mt-0.5 capitalize"}>{sub.checklist_items?.item_type?.replace("_", " ")}</div>
                          {sub.notes && <div className="text-sm text-gray-600 mt-1">{sub.notes}</div>}
                        </div>
                        <span className={"text-xs px-2 py-1 rounded-full font-medium flex-shrink-0 " + (sub.state === "pass" || sub.state === "submitted" ? "bg-teal-50 text-teal-600" : sub.state === "fail" ? "bg-red-50 text-red-500" : "bg-gray-100 text-gray-500")}>
                          {sub.state === "submitted" ? "Done" : sub.state}
                        </span>
                      </div>
                      {/* qa_photo_fix_v1: use onClick + window.open instead of <a> wrapper to prevent expand-state reset */}
                      {(qa.photoUrls?.[sub.id] || sub.photo_url) && (
                        <div className="mt-3">
                          <img
                            src={qa.photoUrls?.[sub.id] || sub.photo_url}
                            alt="QA photo"
                            className="w-full max-h-48 object-cover rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              window.open(qa.photoUrls?.[sub.id] || sub.photo_url, "_blank", "noopener,noreferrer");
                            }}
                          />
                          <p className="text-xs text-gray-400 mt-1">Click to view full size</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {reviewed.length > 0 && (
        <div className={card}>
          <div className="px-6 py-4 border-b border-gray-100">
            <span className="font-semibold">Recently reviewed</span>
          </div>
          {reviewed.slice(0, 10).map((qa: any) => (
            <div key={qa.id} className="flex items-center gap-4 px-6 py-4 border-b border-gray-50 last:border-0">
              <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-sm font-bold flex-shrink-0">{qa.users?.initials || "?"}</div>
              <div className="flex-1">
                <div className="font-medium text-sm">{qa.users?.name} — {qa.jobs?.name}</div>
                <div className={"text-xs text-gray-500"}>{new Date(qa.reviewed_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
                {qa.rejection_note && <div className="text-xs text-red-500 mt-0.5">Rejected: {qa.rejection_note}</div>}
              </div>
              <span className={"text-xs px-2 py-1 rounded-full font-medium " + (qa.status === "approved" ? "bg-teal-50 text-teal-600" : "bg-red-50 text-red-500")}>
                {qa.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
