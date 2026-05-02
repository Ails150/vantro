"use client"

import { useState } from "react"
import UpgradeAIAuditPack from "./UpgradeAIAuditPack"

interface Props {
  jobs: any[]
  aiAuditEnabled?: boolean
}

export default function AuditTab({ jobs, aiAuditEnabled }: Props) {
  if (!aiAuditEnabled) return <UpgradeAIAuditPack />
  const [selectedJob, setSelectedJob] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState<any>(null)
  const [error, setError] = useState("")
  const [shareLink, setShareLink] = useState("")
  const [creatingLink, setCreatingLink] = useState(false)
  const [copied, setCopied] = useState(false)
  const [activeShares, setActiveShares] = useState<any[]>([])

  async function generate() {
    if (!selectedJob) return
    setLoading(true); setError(""); setReport(null); setShareLink("")
    try {
      const params = new URLSearchParams({ jobId: selectedJob })
      if (from) params.set("from", from)
      if (to) params.set("to", to)
      const res = await fetch(`/api/audit?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to generate report")
      setReport(data)
      loadShareLinks(selectedJob)
    } catch (err: any) {
      setError(err?.message || "Failed")
    } finally {
      setLoading(false)
    }
  }

  async function loadShareLinks(jobId: string) {
    try {
      const res = await fetch(`/api/audit/share?jobId=${jobId}`)
      const data = await res.json()
      if (res.ok) setActiveShares(data.shares || [])
    } catch {}
  }

  async function createShareLink() {
    if (!selectedJob) return
    setCreatingLink(true); setError("")
    try {
      const res = await fetch("/api/audit/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: selectedJob, from: from || null, to: to || null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Could not create link")
      setShareLink(data.url)
      loadShareLinks(selectedJob)
    } catch (err: any) {
      setError(err?.message || "Failed")
    } finally {
      setCreatingLink(false)
    }
  }

  async function revokeShare(shareId: string) {
    if (!confirm("Revoke this link? The client will no longer be able to view the report.")) return
    try {
      const res = await fetch(`/api/audit/share/${shareId}`, { method: "DELETE" })
      if (res.ok) loadShareLinks(selectedJob)
    } catch {}
  }

  function copyLink(text: string) {
    if (!text) return
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function exportHTML() {
    if (!report) return
    const job = report.job
    const refId = `VTR-${new Date().getFullYear()}-${selectedJob.slice(0, 8).toUpperCase()}`
    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Audit Report - ${job.name}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; color: #1f2937; }
  h1 { font-size: 24px; margin-bottom: 4px; }
  h2 { font-size: 18px; margin-top: 32px; padding-bottom: 8px; border-bottom: 2px solid #00d4a0; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  th { background: #f9fafb; font-weight: 600; font-size: 13px; }
  td { font-size: 13px; }
  img { max-width: 120px; max-height: 90px; border-radius: 4px; margin: 2px; }
  .meta { background: #f9fafb; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 13px; line-height: 1.6; }
  .pass { color: #059669; font-weight: 600; }
  .fail { color: #dc2626; font-weight: 600; }
  .footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #6b7280; }
</style>
</head>
<body>
<h1>${job.name}</h1>
<div style="color:#6b7280; font-size: 14px;">${job.address}</div>
<div class="meta">
  <strong>Period:</strong> ${report.period?.from || "All time"} to ${report.period?.to || "now"}<br>
  <strong>Generated:</strong> ${new Date(report.generated || Date.now()).toLocaleString("en-GB")}<br>
  <strong>Report Reference:</strong> ${refId}<br>
  <strong>Report produced by:</strong> Vantro - getvantro.com
</div>

<h2>Attendance and GPS Sign-ins (${report.signins.length} records)</h2>
${report.signins.length === 0 ? '<p style="color:#888">No sign-ins recorded in this period</p>' : `
<table><tr><th>Installer</th><th>Signed In</th><th>Signed Out</th><th>Distance In</th><th>Distance Out</th><th>Hours</th></tr>
${report.signins.map((s: any) => {
  const inT = new Date(s.signed_in_at)
  const outT = s.signed_out_at ? new Date(s.signed_out_at) : null
  const hrs = outT ? ((outT.getTime() - inT.getTime()) / 3600000).toFixed(1) : "-"
  return `<tr><td>${s.users?.name || "Unknown"}</td><td>${inT.toLocaleString("en-GB")}</td><td>${outT ? outT.toLocaleString("en-GB") : '<span class="fail">Not signed out</span>'}</td><td>${s.distance_metres ?? "-"}m</td><td>${s.sign_out_distance_metres ?? "-"}m</td><td>${hrs}</td></tr>`
}).join("")}</table>`}

<h2>Site Diary (${report.diary.length} entries)</h2>
${report.diary.length === 0 ? '<p style="color:#888">No diary entries in this period</p>' : `
<table><tr><th>Time</th><th>Installer</th><th>Entry</th><th>Classification</th><th>Photos</th></tr>
${report.diary.map((e: any) => `<tr><td>${new Date(e.created_at).toLocaleString("en-GB")}</td><td>${e.users?.name || "Unknown"}</td><td>${e.entry_text || ""}</td><td>${e.ai_alert_type !== "none" ? (e.ai_summary || e.ai_alert_type) : "-"}</td><td>${e.photo_urls && e.photo_urls.length > 0 ? e.photo_urls.map((u: string) => `<img src="${u}">`).join("") : "-"}</td></tr>`).join("")}</table>`}

<h2>QA Checklists (${report.qa.length} responses)</h2>
${report.qa.length === 0 ? '<p style="color:#888">No QA responses in this period</p>' : `
<table><tr><th>Time</th><th>Installer</th><th>Item</th><th>Result</th><th>Note</th><th>Photo</th></tr>
${report.qa.map((q: any) => `<tr><td>${new Date(q.created_at).toLocaleString("en-GB")}</td><td>${q.users?.name || "Unknown"}</td><td>${q.checklist_items?.label || "-"}</td><td class="${q.result === "pass" ? "pass" : "fail"}">${q.result?.toUpperCase() || "-"}</td><td>${q.note || "-"}</td><td>${q.photo_url ? `<img src="${q.photo_url}">` : "-"}</td></tr>`).join("")}</table>`}

<div class="footer">
  Generated by Vantro field operations software (getvantro.com).<br>
  All timestamps in local time. GPS distances measured from registered job site address.<br>
  CNNCTD Ltd - Vantro is a product of CNNCTD Ltd (NI695071)
</div>
</body>
</html>`

    const blob = new Blob([html], { type: "text/html" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `Vantro-Audit-${report.job.name.replace(/\s+/g, "-")}-${new Date().toISOString().slice(0, 10)}.html`
    a.click()
    URL.revokeObjectURL(url)
  }

  const card = "bg-white border border-gray-200 rounded-2xl shadow-sm"
  const inp = "w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-teal-400"

  // Calculate totals for header
  const totalHours = report ? report.signins.reduce((acc: number, s: any) => {
    if (s.signed_in_at && s.signed_out_at) {
      return acc + (new Date(s.signed_out_at).getTime() - new Date(s.signed_in_at).getTime()) / 3600000
    }
    return acc
  }, 0) : 0
  const photoCount = report ? report.diary.reduce((n: number, e: any) => n + (e.photo_urls?.length || 0), 0) : 0
  const qaPassed = report ? report.qa.filter((q: any) => q.result === "pass").length : 0
  const qaFailed = report ? report.qa.filter((q: any) => q.result === "fail").length : 0

  return (
    <div className="space-y-5">
      <div className={card + " p-6"}>
        <h2 className="text-xl font-semibold text-gray-900 mb-1">Audit and Dispute Report</h2>
        <p className="text-sm text-gray-500 mb-5">
          Generate a full evidence pack for any job - diary entries, photos, GPS sign-ins, QA responses.
        </p>

        <div className="space-y-3 mb-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">JOB</label>
            <select value={selectedJob} onChange={(e) => setSelectedJob(e.target.value)} className={inp}>
              <option value="">Select a job...</option>
              {jobs.map((j: any) => <option key={j.id} value={j.id}>{j.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">FROM (optional)</label>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inp} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">TO (optional)</label>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inp} />
            </div>
          </div>
          <button
            onClick={generate}
            disabled={!selectedJob || loading}
            className="w-full px-4 py-3 bg-teal-500 hover:bg-teal-600 text-white rounded-xl text-sm font-semibold disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed"
          >
            {loading ? "Generating..." : "Generate Report"}
          </button>
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{error}</p>}
      </div>

      {report && (
        <>
          {/* Header card with summary + actions */}
          <div className={card + " p-6"}>
            <div className="flex items-start justify-between mb-5 gap-3 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-gray-900 text-lg">{report.job.name}</div>
                <div className="text-sm text-gray-500">{report.job.address}</div>
                {(from || to) && (
                  <div className="text-xs text-gray-400 mt-1">
                    Period: {from || "all time"} to {to || "now"}
                  </div>
                )}
              </div>
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => { if (!report?.job?.id) return; const params = new URLSearchParams({ jobId: report.job.id }); if (from) params.append('from', from); if (to) params.append('to', to); window.open('/api/audit/report?' + params.toString(), '_blank'); }} className="px-4 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-lg text-sm font-semibold">
                  Download report
                </button>
                <button onClick={createShareLink} disabled={creatingLink} className="px-4 py-2 bg-white border border-teal-300 text-teal-700 hover:bg-teal-50 rounded-lg text-sm font-semibold disabled:opacity-50">
                  {creatingLink ? "Creating..." : "Share with client"}
                </button>
              </div>
            </div>

            {shareLink && (
              <div className="bg-teal-50 border border-teal-200 rounded-lg p-4 mb-5">
                <div className="text-sm font-medium text-teal-900 mb-2">Share link created - expires in 30 days</div>
                <div className="flex gap-2">
                  <input
                    value={shareLink}
                    readOnly
                    className="flex-1 px-3 py-2 bg-white border border-teal-200 rounded-lg text-xs text-gray-700 font-mono"
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <button onClick={() => copyLink(shareLink)} className="px-4 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-lg text-sm font-medium">
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <p className="text-xs text-teal-700 mt-2">
                  Send this to your client. They will see the report without needing to log in.
                </p>
              </div>
            )}

            {/* Summary stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-teal-600">{report.signins.length}</div>
                <div className="text-xs text-gray-500">Sign-ins</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-teal-600">{totalHours.toFixed(1)}h</div>
                <div className="text-xs text-gray-500">Total hours</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-teal-600">{photoCount}</div>
                <div className="text-xs text-gray-500">Photos</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-teal-600">{qaPassed}/{qaPassed + qaFailed}</div>
                <div className="text-xs text-gray-500">QA passed</div>
              </div>
            </div>
          </div>

          {/* Sign-ins detail */}
          <div className={card}>
            <div className="px-6 py-4 border-b border-gray-100">
              <h3 className="font-semibold">Attendance and GPS sign-ins</h3>
              <p className="text-xs text-gray-500 mt-0.5">Every recorded shift with location proof and hours.</p>
            </div>
            {report.signins.length === 0 ? (
              <div className="px-6 py-10 text-center text-gray-400 text-sm">No sign-ins recorded in this period.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-xs text-gray-600">
                      <th className="text-left px-4 py-2">Installer</th>
                      <th className="text-left px-4 py-2">Signed in</th>
                      <th className="text-left px-4 py-2">Signed out</th>
                      <th className="text-right px-4 py-2">Dist in</th>
                      <th className="text-right px-4 py-2">Dist out</th>
                      <th className="text-right px-4 py-2">Hours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.signins.map((s: any) => {
                      const inT = new Date(s.signed_in_at)
                      const outT = s.signed_out_at ? new Date(s.signed_out_at) : null
                      const hrs = outT ? ((outT.getTime() - inT.getTime()) / 3600000).toFixed(1) : "-"
                      return (
                        <tr key={s.id} className="border-t border-gray-100">
                          <td className="px-4 py-2 font-medium">{s.users?.name || "Unknown"}</td>
                          <td className="px-4 py-2 text-gray-600">{inT.toLocaleString("en-GB")}</td>
                          <td className="px-4 py-2 text-gray-600">{outT ? outT.toLocaleString("en-GB") : <span className="text-red-600 font-medium">Open</span>}</td>
                          <td className="px-4 py-2 text-right text-gray-500 text-xs">{s.distance_metres != null ? `${s.distance_metres}m` : "-"}</td>
                          <td className="px-4 py-2 text-right text-gray-500 text-xs">{s.sign_out_distance_metres != null ? `${s.sign_out_distance_metres}m` : "-"}</td>
                          <td className="px-4 py-2 text-right font-semibold">{hrs}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* QA detail */}
          <div className={card}>
            <div className="px-6 py-4 border-b border-gray-100">
              <h3 className="font-semibold">Quality checks</h3>
              <p className="text-xs text-gray-500 mt-0.5">Pass/fail on every checklist item with photo evidence.</p>
            </div>
            {report.qa.length === 0 ? (
              <div className="px-6 py-10 text-center text-gray-400 text-sm">No QA responses recorded in this period.</div>
            ) : (
              <div className="px-6 py-4 space-y-2">
                {report.qa.map((q: any) => (
                  <div key={q.id} className="flex items-start gap-3 py-3 border-b border-gray-50 last:border-0">
                    <span className={"flex-shrink-0 px-2 py-0.5 text-xs font-semibold rounded-full " + (q.result === "pass" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>
                      {q.result === "pass" ? "Pass" : "Fail"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{q.checklist_items?.label || "Unnamed item"}</div>
                      {q.note && <div className="text-xs text-gray-600 mt-0.5">{q.note}</div>}
                      <div className="text-xs text-gray-400 mt-0.5">{new Date(q.created_at).toLocaleString("en-GB")} - {q.users?.name || "Unknown"}</div>
                    </div>
                    {q.photo_url && (
                      <a href={q.photo_url} target="_blank" rel="noopener noreferrer">
                        <img src={q.photo_url} alt="" className="w-16 h-16 object-cover rounded-lg border border-gray-200 hover:opacity-80" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Diary detail */}
          <div className={card}>
            <div className="px-6 py-4 border-b border-gray-100">
              <h3 className="font-semibold">Site diary</h3>
              <p className="text-xs text-gray-500 mt-0.5">Daily updates from the team with photos and AI flags.</p>
            </div>
            {report.diary.length === 0 ? (
              <div className="px-6 py-10 text-center text-gray-400 text-sm">No diary entries recorded in this period.</div>
            ) : (
              <div className="px-6 py-4 space-y-4">
                {report.diary.map((e: any) => (
                  <div key={e.id} className="border-b border-gray-50 pb-4 last:border-0 last:pb-0">
                    <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                      <span>{new Date(e.created_at).toLocaleString("en-GB")}</span>
                      <span>-</span>
                      <span className="font-medium text-gray-700">{e.users?.name || "Unknown"}</span>
                      {e.ai_alert_type && e.ai_alert_type !== "none" && (
                        <span className={"ml-2 px-2 py-0.5 text-xs font-semibold rounded-full " + (e.ai_alert_type === "blocker" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700")}>
                          {e.ai_alert_type}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-800">{e.entry_text}</p>
                    {e.photo_urls && e.photo_urls.length > 0 && (
                      <div className="flex gap-2 mt-2 flex-wrap">
                        {e.photo_urls.map((url: string, i: number) => (
                          <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                            <img src={url} alt="" className="w-24 h-24 object-cover rounded-lg border border-gray-200 hover:opacity-80" />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Active share links */}
      {activeShares.length > 0 && (
        <div className={card}>
          <div className="px-6 py-4 border-b border-gray-100">
            <h3 className="font-semibold">Active share links</h3>
            <p className="text-xs text-gray-500 mt-0.5">Links sent to clients for this job.</p>
          </div>
          {activeShares.map((s) => (
            <div key={s.id} className="border-b border-gray-50 last:border-0 px-6 py-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="font-mono text-xs text-gray-700 truncate">{s.url}</div>
                <div className="text-xs text-gray-500 mt-1">
                  Created {new Date(s.created_at).toLocaleDateString("en-GB")} - Expires {new Date(s.expires_at).toLocaleDateString("en-GB")} - Viewed {s.view_count || 0} time{s.view_count === 1 ? "" : "s"}
                </div>
              </div>
              <button onClick={() => copyLink(s.url)} className="text-xs text-gray-500 hover:text-teal-600 border border-gray-200 rounded-lg px-3 py-1.5">Copy</button>
              <button onClick={() => revokeShare(s.id)} className="text-xs text-gray-500 hover:text-red-600 border border-gray-200 rounded-lg px-3 py-1.5">Revoke</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
