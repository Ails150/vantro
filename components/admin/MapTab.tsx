"use client"
import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { APIProvider, Map, AdvancedMarker, Pin, InfoWindow, useMap } from "@vis.gl/react-google-maps"

const GOOGLE_MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || ""
const GOOGLE_MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID || ""

interface MapData {
  signins: any[]
  locations: any[]
  jobs: any[]
  team?: any[]
  alerts?: any[]
}

type Filter = "all" | "on_site" | "off_site" | "alerts"

function formatDuration(ms: number): string {
  const mins = Math.floor(ms / 60000)
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

// Sub-component to control map imperatively (pan/zoom to selected installer)
function MapController({ focus }: { focus: { lat: number; lng: number } | null }) {
  const map = useMap()
  useEffect(() => {
    if (!map || !focus) return
    map.panTo(focus)
    if ((map.getZoom() || 0) < 14) map.setZoom(14)
  }, [map, focus])
  return null
}

export default function MapTab() {
  const [data, setData] = useState<MapData>({ signins: [], locations: [], jobs: [], team: [], alerts: [] })
  const [selected, setSelected] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [filter, setFilter] = useState<Filter>("all")
  const [search, setSearch] = useState("")
  const [focusPoint, setFocusPoint] = useState<{ lat: number; lng: number } | null>(null)

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/map")
    if (res.ok) {
      const d = await res.json()
      setData(d)
      setLastUpdated(new Date())
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(load, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [load])

  // Build enriched installer rows (one per team member, not just those with locations)
  const team = data.team || []
  const rows = useMemo(() => {
    const now = Date.now()
    // If team list not provided by API, derive from signins + locations
    const members = team.length > 0 ? team : (() => {
      const uniq: Record<string, any> = {}
      data.signins.forEach((s: any) => {
        if (s.users && !uniq[s.user_id]) uniq[s.user_id] = s.users
      })
      return Object.entries(uniq).map(([id, u]) => ({ id, ...u }))
    })()

    return members.map((m: any) => {
      const signin = data.signins.find((s: any) => s.user_id === m.id)
      const location = data.locations.find((l: any) => l.user_id === m.id)
      const alertsForUser = (data.alerts || []).filter((a: any) => a.user_id === m.id)

      let status: "on_site" | "off_site" | "offline" = "offline"
      let statusLabel = "Not signed in today"
      let statusDetail = ""

      if (signin && !signin.signed_out_at) {
        const dur = now - new Date(signin.signed_in_at).getTime()
        if (location?.within_range) {
          status = "on_site"
          statusLabel = `On site ${formatDuration(dur)}`
          statusDetail = signin.jobs?.name || ""
        } else if (location) {
          status = "off_site"
          statusLabel = `Off site (${Math.round(location.distance_from_site_metres)}m away)`
          statusDetail = signin.jobs?.name || ""
        } else {
          status = "on_site"
          statusLabel = `Signed in ${formatDuration(dur)}`
          statusDetail = signin.jobs?.name || ""
        }
      }

      return {
        id: m.id,
        name: m.name || "Unknown",
        initials: m.initials || (m.name || "?").substring(0, 2).toUpperCase(),
        status,
        statusLabel,
        statusDetail,
        location,
        signin,
        hasAlert: alertsForUser.length > 0,
      }
    })
  }, [data])

  // Apply filter + search
  const filteredRows = useMemo(() => {
    let r = rows
    if (filter === "on_site") r = r.filter(x => x.status === "on_site")
    else if (filter === "off_site") r = r.filter(x => x.status === "off_site")
    else if (filter === "alerts") r = r.filter(x => x.hasAlert || x.status === "off_site")

    if (search.trim()) {
      const q = search.trim().toLowerCase()
      r = r.filter(x => x.name.toLowerCase().includes(q) || x.statusDetail.toLowerCase().includes(q))
    }
    return r
  }, [rows, filter, search])

  // KPI counts (always from unfiltered rows)
  const kpis = useMemo(() => ({
    onSite: rows.filter(r => r.status === "on_site").length,
    offSite: rows.filter(r => r.status === "off_site").length,
    notSignedIn: rows.filter(r => r.status === "offline").length,
    alerts: (data.alerts || []).length + rows.filter(r => r.status === "off_site").length,
  }), [rows, data.alerts])

  const defaultCenter = { lat: 52.5, lng: -1.5 }
  const center = data.jobs[0]?.lat ? { lat: data.jobs[0].lat, lng: data.jobs[0].lng } : defaultCenter

  function onRowClick(row: any) {
    if (row.location?.lat && row.location?.lng) {
      const point = { lat: row.location.lat, lng: row.location.lng }
      setFocusPoint(point)
      setSelected({ type: "installer", data: { ...row.location, user: { name: row.name, initials: row.initials }, job: row.signin?.jobs, hoursOnSite: row.statusLabel } })
    }
  }

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 400, color: "#6b7280" }}>
      Loading map...
    </div>
  )

  // ---- STYLES ----
  const kpiCardStyle = (accent: string): React.CSSProperties => ({
    background: "#fff",
    borderRadius: 10,
    padding: "12px 14px",
    borderLeft: `3px solid ${accent}`,
    border: "1px solid #e5e7eb",
    flex: 1,
    minWidth: 0,
  })
  const kpiLabelStyle: React.CSSProperties = { fontSize: 11, color: "#6b7280", margin: 0, textTransform: "uppercase", letterSpacing: 0.3 }
  const kpiValueStyle: React.CSSProperties = { fontSize: 22, fontWeight: 600, color: "#111827", margin: "4px 0 0" }

  const chipStyle = (active: boolean): React.CSSProperties => ({
    fontSize: 12,
    padding: "4px 12px",
    borderRadius: 999,
    border: active ? "1px solid #0f6e56" : "1px solid #e5e7eb",
    background: active ? "#0f6e56" : "#fff",
    color: active ? "#fff" : "#4b5563",
    cursor: "pointer",
    whiteSpace: "nowrap",
  })

  const rowStyle = (row: any, isSelected: boolean): React.CSSProperties => {
    let bg = "#fff"
    if (row.status === "off_site") bg = "#fef2f2"
    else if (row.hasAlert) bg = "#fffbeb"
    if (isSelected) bg = "#ecfeff"
    return {
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "10px 12px",
      borderBottom: "1px solid #f3f4f6",
      cursor: "pointer",
      background: bg,
    }
  }

  const dotColor = (row: any) => {
    if (row.status === "on_site") return "#10b981"
    if (row.status === "off_site") return "#ef4444"
    return "#9ca3af"
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#111827" }}>Live site map</h3>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7280" }}>
            {rows.length} team member{rows.length !== 1 ? "s" : ""} · {data.jobs.length} active job{data.jobs.length !== 1 ? "s" : ""}
            {lastUpdated && ` · Updated ${lastUpdated.toLocaleTimeString("en-GB")}`}
          </p>
        </div>
        <button onClick={load} style={{ padding: "6px 14px", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, color: "#0f6e56", fontSize: 12, cursor: "pointer", fontWeight: 500 }}>
          ↻ Refresh
        </button>
      </div>

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 12 }}>
        <div style={kpiCardStyle("#10b981")}>
          <p style={kpiLabelStyle}>On site</p>
          <p style={kpiValueStyle}>{kpis.onSite}</p>
        </div>
        <div style={kpiCardStyle("#ef4444")}>
          <p style={kpiLabelStyle}>Off site</p>
          <p style={kpiValueStyle}>{kpis.offSite}</p>
        </div>
        <div style={kpiCardStyle("#9ca3af")}>
          <p style={kpiLabelStyle}>Not signed in</p>
          <p style={kpiValueStyle}>{kpis.notSignedIn}</p>
        </div>
        <div style={kpiCardStyle("#f59e0b")}>
          <p style={kpiLabelStyle}>Alerts</p>
          <p style={kpiValueStyle}>{kpis.alerts}</p>
        </div>
      </div>

      {/* Split view */}
      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 12 }}>
        {/* LEFT: installer list */}
        <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e5e7eb", overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: 600 }}>
          {/* Filter chips */}
          <div style={{ padding: "10px 12px", borderBottom: "1px solid #f3f4f6", display: "flex", gap: 6, flexWrap: "wrap" }}>
            <span style={chipStyle(filter === "all")} onClick={() => setFilter("all")}>All {rows.length}</span>
            <span style={chipStyle(filter === "on_site")} onClick={() => setFilter("on_site")}>On site {kpis.onSite}</span>
            <span style={chipStyle(filter === "off_site")} onClick={() => setFilter("off_site")}>Off site {kpis.offSite}</span>
            <span style={chipStyle(filter === "alerts")} onClick={() => setFilter("alerts")}>Alerts {kpis.alerts}</span>
          </div>
          {/* Search */}
          <div style={{ padding: "8px 12px", borderBottom: "1px solid #f3f4f6" }}>
            <input
              type="text"
              placeholder="Search installer or job..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: "100%", fontSize: 12, padding: "6px 10px", border: "1px solid #e5e7eb", borderRadius: 6, outline: "none", boxSizing: "border-box" }}
            />
          </div>
          {/* Rows */}
          <div style={{ overflowY: "auto", flex: 1 }}>
            {filteredRows.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "#9ca3af", fontSize: 13 }}>No matches</div>
            ) : filteredRows.map((row: any) => (
              <div key={row.id} style={rowStyle(row, selected?.data?.user_id === row.id)} onClick={() => onRowClick(row)}>
                <div style={{ width: 32, height: 32, borderRadius: 16, background: "#e0f2fe", color: "#075985", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
                  {row.initials}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.name}</div>
                  <div style={{ fontSize: 11, color: row.status === "off_site" ? "#b91c1c" : "#6b7280", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {row.statusLabel}{row.statusDetail ? ` · ${row.statusDetail}` : ""}
                  </div>
                </div>
                <span style={{ width: 8, height: 8, borderRadius: 4, background: dotColor(row), flexShrink: 0 }} />
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT: map */}
        <div style={{ borderRadius: 10, overflow: "hidden", height: 600, border: "1px solid #e5e7eb" }}>
          <APIProvider apiKey={GOOGLE_MAPS_KEY}>
            <Map
              defaultCenter={center}
              defaultZoom={data.jobs.length > 0 ? 12 : 6}
              mapId={GOOGLE_MAP_ID}
              style={{ width: "100%", height: "100%" }}
              gestureHandling="greedy"
            >
              <MapController focus={focusPoint} />

              {data.jobs.map((job: any) => (
                <AdvancedMarker key={`job-${job.id}`} position={{ lat: job.lat, lng: job.lng }} onClick={() => setSelected({ type: "job", data: job })}>
                  <Pin background="#3b82f6" borderColor="#1d4ed8" glyphColor="#fff" scale={1.1} />
                </AdvancedMarker>
              ))}

              {data.locations.map((loc: any) => {
                const signin = data.signins.find((s: any) => s.user_id === loc.user_id)
                return (
                  <AdvancedMarker key={`installer-${loc.user_id}`} position={{ lat: loc.lat, lng: loc.lng }} onClick={() => setSelected({ type: "installer", data: { ...loc, user: signin?.users, job: signin?.jobs } })}>
                    <Pin background={loc.within_range ? "#10b981" : "#ef4444"} borderColor={loc.within_range ? "#047857" : "#b91c1c"} glyphColor="#fff" scale={1.2} />
                  </AdvancedMarker>
                )
              })}

              {selected && selected.data.lat && selected.data.lng && (
                <InfoWindow position={{ lat: selected.data.lat, lng: selected.data.lng }} onCloseClick={() => setSelected(null)}>
                  <div style={{ padding: 4, minWidth: 160 }}>
                    {selected.type === "job" ? (
                      <>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>{selected.data.name}</div>
                        <div style={{ fontSize: 12, color: "#666" }}>{selected.data.address}</div>
                        <div style={{ fontSize: 12, marginTop: 4, color: "#3b82f6" }}>
                          {data.signins.filter((s: any) => s.job_id === selected.data.id).length} installer(s) on site
                        </div>
                      </>
                    ) : (
                      <>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>{selected.data.user?.name}</div>
                        <div style={{ fontSize: 12, color: "#666" }}>{selected.data.job?.name}</div>
                        <div style={{ fontSize: 12, marginTop: 4 }}>
                          {selected.data.within_range
                            ? <span style={{ color: "#047857" }}>✓ On site ({Math.round(selected.data.distance_from_site_metres)}m)</span>
                            : <span style={{ color: "#b91c1c" }}>⚠ Off site ({Math.round(selected.data.distance_from_site_metres)}m away)</span>
                          }
                        </div>
                        {selected.data.hoursOnSite && (
                          <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>{selected.data.hoursOnSite}</div>
                        )}
                        <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>
                          Last seen: {new Date(selected.data.logged_at).toLocaleTimeString("en-GB")}
                        </div>
                      </>
                    )}
                  </div>
                </InfoWindow>
              )}
            </Map>
          </APIProvider>
        </div>
      </div>

      {rows.length === 0 && data.jobs.length === 0 && (
        <div style={{ textAlign: "center", padding: 40, color: "#6b7280", fontSize: 14 }}>
          No active jobs or team members
        </div>
      )}
    </div>
  )
}