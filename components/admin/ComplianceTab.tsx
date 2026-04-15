"use client"
import { useState, useEffect } from "react"

interface Props {
  companyId: string
  teamMembers: any[]
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
}

export default function ComplianceTab({ companyId, teamMembers }: Props) {
  const [period, setPeriod] = useState("today")
  const [signins, setSignins] = useState<any[]>([])
  const [summary, setSummary] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [breadcrumbs, setBreadcrumbs] = useState<any[]>([])
  const [breadcrumbUser, setBreadcrumbUser] = useState<string | null>(null)
  const [breadcrumbLoading, setBreadcrumbLoading] = useState(false)

  function getDateRange() {
    const now = new Date()
    if (period === "today") { const d = now.toISOString().split("T")[0]; return { start: d, end: d } }
    if (period === "this_week") { const mon = new Date(now); mon.setDate(now.getDate() - ((now.getDay() + 6) % 7)); return { start: mon.toISOString().split("T")[0], end: now.toISOString().split("T")[0] } }
    if (period === "last_week") { const mon = new Date(now); mon.setDate(now.getDate() - ((now.getDay() + 6) % 7) - 7); const sun = new Date(mon); sun.setDate(mon.getDate() + 6); return { start: mon.toISOString().split("T")[0], end: sun.toISOString().split("T")[0] } }
    const d = now.toISOString().split("T")[0]; return { start: d, end: d }
  }

  async function loadData() {
    setLoading(true)
    const { start, end } = getDateRange()
    try { const res = await fetch(`/api/admin/time-report?start=${start}&end=${end}`); const data = await res.json(); setSignins(data.signins || []); setSummary(data.summary || []) } catch {}
    setLoading(false)
  }

  async function loadBreadcrumbs(signinId: string, userName: string) {
    setBreadcrumbLoading(true); setBreadcrumbUser(userName)
    try { const res = await fetch(`/api/admin/breadcrumbs?signinId=${signinId}`); const data = await res.json(); setBreadcrumbs(data.logs || []) } catch {}
    setBreadcrumbLoading(false)
  }

  useEffect(() => { loadData() }, [period])

  const activeSignins = signins.filter(s => !s.signed_out_at)
  const completedSignins = signins.filter(s => s.signed_out_at && !s.flagged && !s.departed_early)
  const earlyDepartures = signins.filter(s => s.departed_early)
  const noSignOut = signins.filter(s => s.auto_closed)

  function complianceColor(score: number) { if (score >= 85) return "text-teal-600"; if (score >= 60) return "text-amber-600"; return "text-red-500" }
  function complianceBg(score: number) { if (score >= 85) return "bg-teal-400"; if (score >= 60) return "bg-amber-400"; return "bg-red-400" }

  function statusBadge(signin: any) {
    if (signin.auto_closed) return { label: `No sign-out \u2014 ${signin.hours_worked || 0}h calculated`, bg: "bg-red-50", border: "border-red-200", text: "text-red-600" }
    if (signin.departed_early) return { label: `Left ${Math.floor((signin.early_departure_minutes || 0) / 60)}h ${(signin.early_departure_minutes || 0) % 60}m early`, bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700" }
    if (!signin.signed_out_at) return { label: "On site", bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700" }
    return { label: "Complete", bg: "bg-teal-50", border: "border-teal-200", text: "text-teal-700" }
  }

  function cardBorder(signin: any) {
    if (signin.auto_closed) return "border-red-300"; if (signin.departed_early) return "border-amber-300"; if (!signin.signed_out_at) return "border-blue-200"; return "border-gray-200"
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        {[{ id: "today", label: "Today" }, { id: "this_week", label: "This week" }, { id: "last_week", label: "Last week" }].map(p => (
          <button key={p.id} onClick={() => setPeriod(p.id)} className={"px-4 py-2 rounded-xl text-sm font-semibold transition-colors " + (period === p.id ? "bg-teal-400 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}>{p.label}</button>
        ))}
        <button onClick={loadData} className="ml-auto text-sm border border-gray-200 rounded-xl px-4 py-2 text-gray-500 hover:text-gray-900">Refresh</button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm"><div className="text-gray-500 text-xs font-medium mb-1">On site now</div><div className="text-3xl font-bold text-blue-500">{activeSignins.length}</div></div>
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm"><div className="text-gray-500 text-xs font-medium mb-1">Signed out</div><div className="text-3xl font-bold text-teal-500">{completedSignins.length}</div></div>
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm"><div className="text-gray-500 text-xs font-medium mb-1">Early departures</div><div className="text-3xl font-bold text-amber-500">{earlyDepartures.length}</div></div>
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm"><div className="text-gray-500 text-xs font-medium mb-1">No sign-out</div><div className="text-3xl font-bold text-red-500">{noSignOut.length}</div></div>
      </div>

      {loading && <div className="text-center py-12 text-gray-400">Loading attendance data...</div>}

      {!loading && signins.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-semibold text-gray-900">{period === "today" ? "Today's" : period === "this_week" ? "This week's" : "Last week's"} attendance</h3>
          {signins.map((s: any) => {
            const badge = statusBadge(s); const border = cardBorder(s)
            return (
              <div key={s.id} className={"bg-white border rounded-2xl overflow-hidden shadow-sm " + border}>
                <div className="p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className={"w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm " + (s.auto_closed ? "bg-red-50 text-red-600" : s.departed_early ? "bg-amber-50 text-amber-700" : !s.signed_out_at ? "bg-blue-50 text-blue-600" : "bg-teal-50 text-teal-600")}>{s.users?.initials || "?"}</div>
                      <div><div className="font-semibold text-sm">{s.users?.name}</div><div className="text-xs text-gray-500">{s.jobs?.name}{s.jobs?.address ? " \u2014 " + s.jobs.address : ""}</div></div>
                    </div>
                    <span className={"text-xs px-3 py-1 rounded-full font-semibold border " + badge.bg + " " + badge.border + " " + badge.text}>{badge.label}</span>
                  </div>
                  <div className="grid grid-cols-5 gap-3 text-xs">
                    <div><span className="text-gray-500">Sign in</span><br/><span className="font-semibold">{formatTime(s.signed_in_at)}</span><br/><span className="text-gray-400">{s.distance_from_site_metres != null ? s.distance_from_site_metres + "m from site" : ""}</span></div>
                    <div><span className="text-gray-500">Sign out</span><br/>{s.signed_out_at ? (<><span className={"font-semibold " + (s.auto_closed ? "text-red-500" : s.departed_early ? "text-amber-600" : "")}>{s.auto_closed ? "Auto-closed" : formatTime(s.signed_out_at)}</span><br/>{!s.auto_closed && s.sign_out_distance_metres != null && <span className="text-gray-400">{s.sign_out_distance_metres}m from site</span>}</>) : <span className="font-semibold text-blue-500">{"\u2014"}</span>}</div>
                    <div><span className="text-gray-500">Expected</span><br/><span className="font-semibold">{s.expected_sign_out_time ? s.expected_sign_out_time.slice(0, 5) : "\u2014"}</span></div>
                    <div><span className="text-gray-500">Hours</span><br/><span className={"font-semibold text-base " + (s.auto_closed ? "text-red-500" : s.departed_early ? "text-amber-600" : "")}>{s.hours_worked != null ? Number(s.hours_worked).toFixed(2) : "\u2014"}</span></div>
                    <div><span className="text-gray-500">Trail</span><br/><button onClick={() => loadBreadcrumbs(s.id, s.users?.name || "?")} className="text-teal-600 hover:text-teal-800 text-xs font-semibold underline">View GPS trail</button></div>
                  </div>
                  {s.flag_reason && <div className={"mt-3 pt-3 border-t text-xs " + (s.auto_closed ? "border-red-100 text-red-500" : "border-amber-100 text-amber-600")}>{s.flag_reason}</div>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!loading && signins.length === 0 && <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center text-gray-400 shadow-sm">No attendance data for this period</div>}

      {!loading && summary.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-semibold">Compliance scores</h3>
            <span className="text-sm text-gray-500">{period === "today" ? "Today" : period === "this_week" ? "This week" : "Last week"}</span>
          </div>
          <div className="px-6 py-4 space-y-4">
            {summary.sort((a: any, b: any) => (b.compliance_score || 0) - (a.compliance_score || 0)).map((u: any) => (
              <div key={u.user_id}>
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold">{u.initials || "?"}</div>
                  <span className="font-medium text-sm flex-1">{u.name}</span>
                  <div className="flex items-center gap-4 text-xs text-gray-500">
                    <span>{u.total_days} day{u.total_days !== 1 ? "s" : ""}</span>
                    <span>{Number(u.total_hours || 0).toFixed(1)}h total</span>
                    {u.early_departure_count > 0 && <span className="text-amber-600">{u.early_departure_count} early</span>}
                    {u.auto_closed_count > 0 && <span className="text-red-500">{u.auto_closed_count} no sign-out</span>}
                  </div>
                  <span className={"font-bold text-sm min-w-[40px] text-right " + complianceColor(u.compliance_score || 0)}>{u.compliance_score || 0}%</span>
                </div>
                <div className="h-2 rounded-full bg-gray-100 overflow-hidden"><div className={"h-full rounded-full transition-all " + complianceBg(u.compliance_score || 0)} style={{ width: (u.compliance_score || 0) + "%" }} /></div>
              </div>
            ))}
          </div>
        </div>
      )}

      {breadcrumbUser && (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-semibold">GPS breadcrumb trail {"\u2014"} {breadcrumbUser}</h3>
            <button onClick={() => { setBreadcrumbUser(null); setBreadcrumbs([]) }} className="text-sm text-gray-500 hover:text-gray-900">Close</button>
          </div>
          <div className="px-6 py-4">
            {breadcrumbLoading && <div className="text-center py-8 text-gray-400">Loading trail...</div>}
            {!breadcrumbLoading && breadcrumbs.length === 0 && <div className="text-center py-8 text-gray-400">No breadcrumb data for this session</div>}
            {!breadcrumbLoading && breadcrumbs.length > 0 && (
              <div>
                <div ref={(el) => {
                  if (!el || !(window as any).google || !breadcrumbs.length) return
                  const google = (window as any).google
                  const center = { lat: breadcrumbs[0].lat, lng: breadcrumbs[0].lng }
                  const map = new google.maps.Map(el, { zoom: 15, center, mapTypeId: "roadmap", styles: [{ featureType: "poi", stylers: [{ visibility: "off" }] }] })
                  const path = breadcrumbs.map((b: any) => ({ lat: b.lat, lng: b.lng }))
                  new google.maps.Polyline({ path, geodesic: true, strokeColor: "#00d4a0", strokeOpacity: 1.0, strokeWeight: 3, map })
                  breadcrumbs.forEach((b: any, i: number) => {
                    const isFirst = i === 0
                    const isLast = i === breadcrumbs.length - 1
                    const onSite = b.within_range
                    const color = isFirst ? "#00d4a0" : isLast ? "#6366f1" : onSite ? "#00d4a0" : b.distance_from_site_metres > 500 ? "#ef4444" : "#f59e0b"
                    new google.maps.Marker({
                      position: { lat: b.lat, lng: b.lng },
                      map,
                      icon: { path: google.maps.SymbolPath.CIRCLE, scale: isFirst || isLast ? 8 : 5, fillColor: color, fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2 },
                      title: formatTime(b.logged_at) + " — " + (b.distance_from_site_metres != null ? b.distance_from_site_metres + "m from site" : "")
                    })
                  })
                }} style={{ width: "100%", height: "400px", borderRadius: "12px" }} />
                <div className="mt-3 flex items-center gap-4 text-xs text-gray-500">
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-teal-400 inline-block" /> On site</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-amber-400 inline-block" /> Near site</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-400 inline-block" /> Off site</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-indigo-500 inline-block" /> Last point</span>
                </div>
                <div className="mt-3 space-y-1 max-h-48 overflow-y-auto">
                  {breadcrumbs.map((log: any, i: number) => {
                    const onSite = log.within_range
                    return (
                      <div key={log.id || i} className="flex items-center gap-3 py-1">
                        <div className={"w-2 h-2 rounded-full flex-shrink-0 " + (onSite ? "bg-teal-400" : log.distance_from_site_metres > 500 ? "bg-red-400" : "bg-amber-400")} />
                        <span className="text-xs text-gray-500 min-w-[44px]">{formatTime(log.logged_at)}</span>
                        <span className="text-xs flex-1">{log.distance_from_site_metres != null ? (log.distance_from_site_metres >= 1000 ? (log.distance_from_site_metres / 1000).toFixed(1) + "km from site" : log.distance_from_site_metres + "m from site") : "Location logged"}</span>
                        <span className={"text-xs font-medium " + (onSite ? "text-teal-600" : log.distance_from_site_metres > 500 ? "text-red-500" : "text-amber-600")}>{onSite ? "On site" : "Off site"}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
