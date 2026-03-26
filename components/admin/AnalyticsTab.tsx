"use client"
import { useState, useEffect } from "react"

interface Props { companyId: string; teamMembers: any[]; jobs: any[] }

export default function AnalyticsTab({ companyId, teamMembers, jobs }: Props) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const installers = teamMembers.filter((m: any) => m.role === "installer")
  const activeJobs = jobs.filter((j: any) => j.status === "active")
  const completedJobs = jobs.filter((j: any) => j.status === "completed")

  useEffect(() => {
    async function fetch_data() {
      const res = await fetch("/api/analytics")
      const d = await res.json()
      setData(d)
      setLoading(false)
    }
    fetch_data()
  }, [])

  const sub = "text-gray-500"
  const card = "bg-white border border-gray-200 rounded-2xl shadow-sm"

  if (loading) return <div className="flex items-center justify-center py-24"><div className="w-8 h-8 border-2 border-teal-400 border-t-transparent rounded-full animate-spin"/></div>

  const qaTotal = (data?.approved_qa || 0) + (data?.rejected_qa || 0)
  const qaPassRate = qaTotal > 0 ? Math.round((data.approved_qa / qaTotal) * 100) : null
  const notSignedInToday = installers.filter((m: any) => !data?.signed_in_today?.includes(m.id))
  const stalledJobs = jobs.filter((j: any) => j.status === "active" && data?.stalled_job_ids?.includes(j.id))

  return (
    <div className="space-y-6">

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Active jobs", value: activeJobs.length, color: "text-teal-500", sub: completedJobs.length + " completed" },
          { label: "Team size", value: installers.length, color: "text-gray-900", sub: "installers" },
          { label: "QA pass rate", value: qaPassRate !== null ? qaPassRate + "%" : "—", color: qaPassRate !== null && qaPassRate >= 80 ? "text-teal-500" : "text-amber-500", sub: qaTotal + " submissions total" },
          { label: "Alerts this week", value: data?.alerts_this_week || 0, color: data?.alerts_this_week > 0 ? "text-red-500" : "text-gray-400", sub: "issues + blockers" },
        ].map((s: any) => (
          <div key={s.label} className={card + " p-6"}>
            <div className={"text-sm font-medium mb-2 " + sub}>{s.label}</div>
            <div className={"text-4xl font-bold " + s.color}>{s.value}</div>
            <div className={"text-xs mt-1 " + sub}>{s.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-5">

        <div className={card + " overflow-hidden"}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <span className="font-semibold">Hours on site this week</span>
          </div>
          {!data?.hours_this_week?.length ? (
            <div className={"px-6 py-10 text-center " + sub + " text-sm"}>No sign-ins this week</div>
          ) : data.hours_this_week.map((h: any) => (
            <div key={h.installer_id} className="flex items-center gap-4 px-6 py-4 border-b border-gray-50 last:border-0">
              <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-sm font-bold flex-shrink-0">{h.initials}</div>
              <div className="flex-1">
                <div className="font-medium text-sm">{h.name}</div>
                <div className="mt-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-teal-400 rounded-full" style={{ width: Math.min((h.hours / (data.max_hours || 1)) * 100, 100) + "%" }}/>
                </div>
              </div>
              <div className="text-sm font-bold text-teal-500 flex-shrink-0">{h.hours.toFixed(1)}h</div>
            </div>
          ))}
        </div>

        <div className={card + " overflow-hidden"}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <span className="font-semibold">Not signed in today</span>
            {notSignedInToday.length > 0 && <span className="text-xs bg-amber-50 text-amber-600 border border-amber-200 px-2 py-1 rounded-full font-medium">{notSignedInToday.length} absent</span>}
          </div>
          {notSignedInToday.length === 0 ? (
            <div className={"px-6 py-10 text-center text-teal-500 text-sm font-medium"}>All installers on site</div>
          ) : notSignedInToday.map((m: any) => (
            <div key={m.id} className="flex items-center gap-3 px-6 py-4 border-b border-gray-50 last:border-0">
              <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-sm font-bold flex-shrink-0">{m.initials}</div>
              <div className="flex-1">
                <div className="font-medium text-sm">{m.name}</div>
                <div className={"text-xs " + sub}>{m.email}</div>
              </div>
              <span className="text-xs bg-gray-100 text-gray-500 px-2 py-1 rounded-full">Not signed in</span>
            </div>
          ))}
        </div>

        <div className={card + " overflow-hidden"}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <span className="font-semibold">Jobs by hours spent</span>
          </div>
          {!data?.hours_per_job?.length ? (
            <div className={"px-6 py-10 text-center " + sub + " text-sm"}>No data yet</div>
          ) : data.hours_per_job.map((j: any) => (
            <div key={j.job_id} className="flex items-center gap-4 px-6 py-4 border-b border-gray-50 last:border-0">
              <div className="flex-1">
                <div className="font-medium text-sm">{j.name}</div>
                <div className="mt-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-teal-400 rounded-full" style={{ width: Math.min((j.hours / (data.max_job_hours || 1)) * 100, 100) + "%" }}/>
                </div>
              </div>
              <div className="text-sm font-bold text-teal-500 flex-shrink-0">{j.hours.toFixed(1)}h</div>
            </div>
          ))}
        </div>

        <div className={card + " overflow-hidden"}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <span className="font-semibold">Stalled jobs</span>
            <span className={"text-xs " + sub}>No activity in 7+ days</span>
          </div>
          {stalledJobs.length === 0 ? (
            <div className={"px-6 py-10 text-center text-teal-500 text-sm font-medium"}>No stalled jobs</div>
          ) : stalledJobs.map((j: any) => (
            <div key={j.id} className="flex items-center gap-4 px-6 py-4 border-b border-gray-50 last:border-0">
              <div className="flex-1">
                <div className="font-medium text-sm">{j.name}</div>
                <div className={"text-xs " + sub}>{j.address}</div>
              </div>
              <span className="text-xs bg-amber-50 text-amber-600 px-2 py-1 rounded-full font-medium">Stalled</span>
            </div>
          ))}
        </div>

      </div>
    </div>
  )
}
