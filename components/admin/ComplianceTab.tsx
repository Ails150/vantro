"use client"
import { useState, useEffect, useMemo } from "react"

interface Props {
  companyId: string
  teamMembers: any[]
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
}

function formatDate(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const yest = new Date(); yest.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return "Today"
  if (d.toDateString() === yest.toDateString()) return "Yesterday"
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" })
}

type FilterId = "all" | "on_site" | "early" | "no_signout" | "complete"

export default function ComplianceTab({ companyId, teamMembers }: Props) {
  const [period, setPeriod] = useState("today")
  const [signins, setSignins] = useState<any[]>([])
  const [summary, setSummary] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [breadcrumbs, setBreadcrumbs] = useState<any[]>([])
  const [breadcrumbUser, setBreadcrumbUser] = useState<string | null>(null)
  const [breadcrumbLoading, setBreadcrumbLoading] = useState(false)
  const [filter, setFilter] = useState<FilterId>("all")
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [search, setSearch] = useState("")

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
  const completedSignins = signins.filter(s => s.signed_out_at && !s.flagged && !s.departed_early && !s.auto_closed)
  const earlyDepartures = signins.filter(s => s.departed_early)
  const noSignOut = signins.filter(s => s.auto_closed)

  // Filter + search applied to signins
  const filteredSignins = useMemo(() => {
    let out = signins
    if (filter === "on_site") out = out.filter(s => !s.signed_out_at)
    else if (filter === "early") out = out.filter(s => s.departed_early)
    else if (filter === "no_signout") out = out.filter(s => s.auto_closed)
    else if (filter === "complete") out = out.filter(s => s.signed_out_at && !s.flagged && !s.departed_early && !s.auto_closed)
    if (search.trim()) {
      const q = search.toLowerCase()
      out = out.filter(s => (s.users?.name || "").toLowerCase().includes(q) || (s.jobs?.name || "").toLowerCase().includes(q))
    }
    return out
  }, [signins, filter, search])

  // Group by installer
  const groupedByInstaller = useMemo(() => {
    const groups: Record<string, { user: any; entries: any[]; stats: { days: number; hours: number; early: number; noSignOut: number; onSite: boolean } }> = {}
    for (const s of filteredSignins) {
      const uid = s.user_id
      if (!groups[uid]) {
        groups[uid] = { user: { id: uid, name: s.users?.name || "Unknown", initials: s.users?.initials || "?" }, entries: [], stats: { days: 0, hours: 0, early: 0, noSignOut: 0, onSite: false } }
      }
      groups[uid].entries.push(s)
      groups[uid].stats.days += 1
      groups[uid].stats.hours += Number(s.hours_worked || 0)
      if (s.departed_early) groups[uid].stats.early += 1
      if (s.auto_closed) groups[uid].stats.noSignOut += 1
      if (!s.signed_out_at) groups[uid].stats.onSite = true
    }
    Object.values(groups).forEach(g => g.entries.sort((a, b) => new Date(b.signed_in_at).getTime() - new Date(a.signed_in_at).getTime()))
    return Object.values(groups).sort((a, b) => {
      if (a.stats.onSite !== b.stats.onSite) return a.stats.onSite ? -1 : 1
      const aIssues = a.stats.early + a.stats.noSignOut
      const bIssues = b.stats.early + b.stats.noSignOut
      if (aIssues !== bIssues) return bIssues - aIssues
      return a.user.name.localeCompare(b.user.name)
    })
  }, [filteredSignins])

  function toggleExpand(uid: string) { setExpanded(prev => ({ ...prev, [uid]: !prev[uid] })) }
  function expandAll() { const next: Record<string, boolean> = {}; groupedByInstaller.forEach(g => { next[g.user.id] = true }); setExpanded(next) }
  function collapseAll() { setExpanded({}) }

  const filters: { id: FilterId; label: string; count: number }[] = [
    { id: "all", label: "All", count: signins.length },
    { id: "on_site", label: "On site", count: activeSignins.length },
    { id: "early", label: "Early", count: earlyDepartures.length },
    { id: "no_signout", label: "No sign-out", count: noSignOut.length },
    { id: "complete", label: "Complete", count: completedSignins.length },
  ]

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
        <>
          <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              {filters.map(f => (
                <button key={f.id} onClick={() => setFilter(f.id)} className={"px-3 py-1.5 rounded-full text-xs font-semibold transition-colors flex items-center gap-2 " + (filter === f.id ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}>
                  {f.label}
                  <span className={"px-1.5 py-0.5 rounded-full text-[10px] " + (filter === f.id ? "bg-white/20" : "bg-white text-gray-500")}>{f.count}</span>
                </button>
              ))}
            </div>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search installer or job..." className="ml-auto bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:border-teal-400 min-w-[180px]" />
            <button onClick={expandAll} className="text-xs text-gray-500 hover:text-gray-900 underline">Expand all</button>
            <button onClick={collapseAll} className="text-xs text-gray-500 hover:text-gray-900 underline">Collapse</button>
          </div>
          {groupedByInstaller.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center text-gray-400 shadow-sm">No matches</div>
          ) : (
            <div className="space-y-3">
              {groupedByInstaller.map(group => {
                const uid = group.user.id
                const isExpanded = expanded[uid]
                const { stats } = group
                return (
                  <div key={uid} className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                    <button onClick={() => toggleExpand(uid)} className="w-full px-5 py-4 flex items-center gap-3 hover:bg-gray-50 transition-colors text-left">
                      <div className={"w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm " + (stats.onSite ? "bg-blue-50 text-blue-600" : stats.noSignOut > 0 ? "bg-red-50 text-red-600" : stats.early > 0 ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-600")}>{group.user.initials}</div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm">{group.user.name}</div>
                        <div className="text-xs text-gray-500 flex items-center gap-3 flex-wrap mt-0.5">
                          <span>{(() => {
                            const dates = group.entries.map((e: any) => new Date(e.signed_in_at)).sort((a, b) => a.getTime() - b.getTime());
                            const first = dates[0];
                            const last = dates[dates.length - 1];
                            const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
                            if (first.toDateString() === last.toDateString()) return fmt(first);
                            return fmt(first) + ' – ' + fmt(last);
                          })()}</span>
                          <span>{stats.days} day{stats.days !== 1 ? "s" : ""}</span>
                          <span>{stats.hours.toFixed(1)}h total</span>
                          {stats.onSite && <span className="text-blue-600 font-semibold">On site now</span>}
                          {stats.early > 0 && <span className="text-amber-600">{stats.early} early</span>}
                          {stats.noSignOut > 0 && <span className="text-red-500">{stats.noSignOut} no sign-out</span>}
                        </div>
                      </div>
                      <span className="text-xs text-gray-400">{isExpanded ? "▾" : "▸"}</span>
                    </button>
                    {isExpanded && (
                      <div className="border-t border-gray-100 divide-y divide-gray-50">
                        {group.entries.map((s: any) => {
                          const badge = statusBadge(s); const border = cardBorder(s)
                          return (
                            <div key={s.id} className={"px-5 py-4 border-l-4 " + border}>
                              <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
                                <div className="flex items-center gap-3">
                                  <div className="text-xs font-semibold text-gray-900 bg-gray-100 px-2 py-1 rounded-md">{formatDate(s.signed_in_at)}</div>
                                  <div className="text-xs text-gray-500">{s.jobs?.name}{s.jobs?.address ? " — " + s.jobs.address : ""}</div>
                                </div>
                                <span className={"text-xs px-3 py-1 rounded-full font-semibold border " + badge.bg + " " + badge.border + " " + badge.text}>{badge.label}</span>
                              </div>
                              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
                                <div><span className="text-gray-500">Sign in</span><br/><span className="font-semibold">{formatTime(s.signed_in_at)}</span><br/><span className="text-gray-400">{s.distance_from_site_metres != null ? s.distance_from_site_metres + "m from site" : ""}</span></div>
                                <div><span className="text-gray-500">Sign out</span><br/>{s.signed_out_at ? (<><span className={"font-semibold " + (s.auto_closed ? "text-red-500" : s.departed_early ? "text-amber-600" : "")}>{s.auto_closed ? "Auto-closed" : formatTime(s.signed_out_at)}</span><br/>{!s.auto_closed && s.sign_out_distance_metres != null && <span className="text-gray-400">{s.sign_out_distance_metres}m from site</span>}</>) : <span className="font-semibold text-blue-500">—</span>}</div>
                                <div><span className="text-gray-500">Expected</span><br/><span className="font-semibold">{s.expected_sign_out_time ? s.expected_sign_out_time.slice(0, 5) : "—"}</span></div>
                                <div><span className="text-gray-500">Hours</span><br/><span className={"font-semibold text-base " + (s.auto_closed ? "text-red-500" : s.departed_early ? "text-amber-600" : "")}>{s.hours_worked != null ? Number(s.hours_worked).toFixed(2) : "—"}</span></div>
                                <div><span className="text-gray-500">Trail</span><br/><button onClick={() => loadBreadcrumbs(s.id, s.users?.name || "?")} className="text-teal-600 hover:text-teal-800 text-xs font-semibold underline">View GPS trail</button></div>
                              </div>
                              {s.flag_reason && <div className={"mt-3 pt-3 border-t text-xs " + (s.auto_closed ? "border-red-100 text-red-500" : "border-amber-100 text-amber-600")}>{s.flag_reason}</div>}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
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
