import { notFound } from "next/navigation"
import { createServiceClient } from "@/lib/supabase/server"

// Public audit report page — no login required.
// Validates the token, increments view count, renders the evidence pack.

export const dynamic = "force-dynamic"

async function fetchAuditData(jobId: string, companyId: string, from: string | null, to: string | null) {
  const service = await createServiceClient()

  // Job
  const { data: job } = await service
    .from("jobs")
    .select("id, name, address, company_id, lat, lng, created_at")
    .eq("id", jobId)
    .single()

  if (!job || job.company_id !== companyId) return null

  // Sign-ins
  let signinsQ = service
    .from("signins")
    .select("id, user_id, signed_in_at, signed_out_at, distance_metres, sign_out_distance_metres, hours_worked, users:user_id (name, email)")
    .eq("job_id", jobId)
    .order("signed_in_at", { ascending: true })
  if (from) signinsQ = signinsQ.gte("signed_in_at", from)
  if (to) signinsQ = signinsQ.lte("signed_in_at", to)
  const { data: signins } = await signinsQ

  // Diary
  let diaryQ = service
    .from("diary_entries")
    .select("id, user_id, entry_text, photo_urls, ai_alert_type, ai_summary, created_at, users:user_id (name)")
    .eq("job_id", jobId)
    .order("created_at", { ascending: true })
  if (from) diaryQ = diaryQ.gte("created_at", from)
  if (to) diaryQ = diaryQ.lte("created_at", to)
  const { data: diary } = await diaryQ

  // QA
  let qaQ = service
    .from("qa_responses")
    .select("id, user_id, item_id, result, note, photo_url, created_at, users:user_id (name), checklist_items:item_id (label)")
    .eq("job_id", jobId)
    .order("created_at", { ascending: true })
  if (from) qaQ = qaQ.gte("created_at", from)
  if (to) qaQ = qaQ.lte("created_at", to)
  const { data: qa } = await qaQ

  return {
    job,
    signins: signins || [],
    diary: diary || [],
    qa: qa || [],
  }
}

export default async function PublicAuditPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  const service = await createServiceClient()
  const { data: share } = await service
    .from("audit_shares")
    .select("id, company_id, job_id, date_from, date_to, expires_at, revoked, view_count, companies:company_id (name)")
    .eq("token", token)
    .maybeSingle()

  if (!share || share.revoked) notFound()
  if (new Date(share.expires_at) < new Date()) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm max-w-md p-8 text-center">
          <h1 className="text-xl font-semibold mb-2">Link expired</h1>
          <p className="text-sm text-gray-600">This audit report link has expired. Please contact the contractor for a new link.</p>
        </div>
      </div>
    )
  }

  // Increment view count (fire and forget)
  await service
    .from("audit_shares")
    .update({
      view_count: (share.view_count || 0) + 1,
      last_viewed_at: new Date().toISOString(),
    })
    .eq("id", share.id)

  const data = await fetchAuditData(share.job_id, share.company_id, share.date_from, share.date_to)
  if (!data) notFound()

  const totalHours = data.signins.reduce((acc: number, s: any) => {
    if (s.hours_worked != null) return acc + Number(s.hours_worked)
    if (s.signed_in_at && s.signed_out_at) {
      return acc + (new Date(s.signed_out_at).getTime() - new Date(s.signed_in_at).getTime()) / 3600000
    }
    return acc
  }, 0)

  const photoCount = data.diary.reduce((n: number, e: any) => n + (e.photo_urls?.length || 0), 0)
  const passedQa = data.qa.filter((q: any) => q.result === "pass").length
  const failedQa = data.qa.filter((q: any) => q.result === "fail").length

  const companyName = (share as any).companies?.name || "Contractor"

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-6 py-5 flex items-center justify-between">
          <div>
            <div className="text-sm text-gray-500">{companyName}</div>
            <h1 className="text-2xl font-bold text-gray-900 mt-0.5">Job Report</h1>
          </div>
          <div className="text-right text-xs text-gray-400">
            <div>Powered by Vantro</div>
            <div>Field operations</div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {/* Job overview */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-xl font-semibold text-gray-900">{data.job.name}</h2>
          <p className="text-sm text-gray-500 mt-1">{data.job.address}</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5">
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-2xl font-bold text-teal-600">{data.signins.length}</div>
              <div className="text-xs text-gray-500">Sign-ins</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-2xl font-bold text-teal-600">{totalHours.toFixed(1)}h</div>
              <div className="text-xs text-gray-500">Total hours</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-2xl font-bold text-teal-600">{photoCount}</div>
              <div className="text-xs text-gray-500">Site photos</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-2xl font-bold text-teal-600">{passedQa}/{passedQa + failedQa}</div>
              <div className="text-xs text-gray-500">QA passed</div>
            </div>
          </div>
        </div>

        {/* Sign-ins */}
        {data.signins.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm">
            <div className="px-6 py-4 border-b border-gray-100">
              <h3 className="font-semibold">Attendance & GPS sign-ins</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-600">
                    <th className="text-left px-4 py-2">Installer</th>
                    <th className="text-left px-4 py-2">Signed in</th>
                    <th className="text-left px-4 py-2">Signed out</th>
                    <th className="text-right px-4 py-2">Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {data.signins.map((s: any) => {
                    const inT = new Date(s.signed_in_at)
                    const outT = s.signed_out_at ? new Date(s.signed_out_at) : null
                    const hrs = outT ? ((outT.getTime() - inT.getTime()) / 3600000).toFixed(1) : "—"
                    return (
                      <tr key={s.id} className="border-t border-gray-100">
                        <td className="px-4 py-2">{s.users?.name || "Unknown"}</td>
                        <td className="px-4 py-2 text-gray-600">{inT.toLocaleString("en-GB")}</td>
                        <td className="px-4 py-2 text-gray-600">{outT ? outT.toLocaleString("en-GB") : <span className="text-red-600">Open</span>}</td>
                        <td className="px-4 py-2 text-right font-medium">{hrs}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* QA */}
        {data.qa.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm">
            <div className="px-6 py-4 border-b border-gray-100">
              <h3 className="font-semibold">Quality checks</h3>
            </div>
            <div className="px-6 py-4 space-y-2">
              {data.qa.map((q: any) => (
                <div key={q.id} className="flex items-start gap-3 py-2 border-b border-gray-50 last:border-0">
                  <span className={"flex-shrink-0 px-2 py-0.5 text-xs font-semibold rounded-full " + (q.result === "pass" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>
                    {q.result === "pass" ? "✓ Pass" : "✗ Fail"}
                  </span>
                  <div className="flex-1">
                    <div className="text-sm font-medium">{q.checklist_items?.label || "—"}</div>
                    {q.note && <div className="text-xs text-gray-500 mt-0.5">{q.note}</div>}
                    <div className="text-xs text-gray-400 mt-0.5">{new Date(q.created_at).toLocaleString("en-GB")} · {q.users?.name}</div>
                  </div>
                  {q.photo_url && (
                    <img src={q.photo_url} alt="" className="w-16 h-16 object-cover rounded-lg border border-gray-200" />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Diary entries */}
        {data.diary.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm">
            <div className="px-6 py-4 border-b border-gray-100">
              <h3 className="font-semibold">Site diary</h3>
            </div>
            <div className="px-6 py-4 space-y-4">
              {data.diary.map((e: any) => (
                <div key={e.id} className="border-b border-gray-50 pb-4 last:border-0 last:pb-0">
                  <div className="text-xs text-gray-500 mb-1">
                    {new Date(e.created_at).toLocaleString("en-GB")} · {e.users?.name}
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
                        <img key={i} src={url} alt="" className="w-24 h-24 object-cover rounded-lg border border-gray-200" />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {data.signins.length === 0 && data.qa.length === 0 && data.diary.length === 0 && (
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-12 text-center text-gray-500">
            <p>No activity recorded for this job yet.</p>
          </div>
        )}

        <div className="text-center text-xs text-gray-400 pt-4">
          Report generated {new Date().toLocaleString("en-GB")} · Powered by Vantro
        </div>
      </div>
    </div>
  )
}
