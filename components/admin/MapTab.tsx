"use client"
import { useState, useEffect, useCallback } from "react"
import { APIProvider, Map, AdvancedMarker, Pin, InfoWindow } from "@vis.gl/react-google-maps"

const GOOGLE_MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || ""
const GOOGLE_MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID || ""

interface MapData {
  signins: any[]
  locations: any[]
  jobs: any[]
}

export default function MapTab() {
  const [data, setData] = useState<MapData>({ signins: [], locations: [], jobs: [] })
  const [selected, setSelected] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

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
    const interval = setInterval(load, 5 * 60 * 1000) // refresh every 5 mins
    return () => clearInterval(interval)
  }, [load])

  // Build installer markers from location_logs
  const installerMarkers = data.locations.map((loc: any) => {
    const signin = data.signins.find((s: any) => s.user_id === loc.user_id)
    const job = signin?.jobs
    const user = signin?.users
    const signInTime = signin ? new Date(signin.signed_in_at) : null
    const hoursOnSite = signInTime ? ((Date.now() - signInTime.getTime()) / 3600000).toFixed(1) : null
    return { ...loc, user, job, signin, hoursOnSite }
  })

  // Default center — UK
  const defaultCenter = { lat: 52.5, lng: -1.5 }
  const center = data.jobs[0]?.lat ? { lat: data.jobs[0].lat, lng: data.jobs[0].lng } : defaultCenter

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 400, color: "#4d6478" }}>
      Loading map...
    </div>
  )

  return (
    <div style={{ position: "relative" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#fff" }}>Live Site Map</h3>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#4d6478" }}>
            {installerMarkers.length} installer{installerMarkers.length !== 1 ? "s" : ""} on site · {data.jobs.length} active job{data.jobs.length !== 1 ? "s" : ""}
            {lastUpdated && ` · Updated ${lastUpdated.toLocaleTimeString("en-GB")}`}
          </p>
        </div>
        <button onClick={load} style={{ padding: "6px 14px", background: "#1a2635", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#00d4a0", fontSize: 12, cursor: "pointer" }}>
          ↻ Refresh
        </button>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 16, marginBottom: 12, flexWrap: "wrap" }}>
        {[
          { color: "#00d4a0", label: "Installer on site" },
          { color: "#f87171", label: "Installer off site" },
          { color: "#3b82f6", label: "Job site" },
        ].map(({ color, label }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: color }} />
            <span style={{ fontSize: 12, color: "#4d6478" }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Map */}
      <div style={{ borderRadius: 12, overflow: "hidden", height: 520 }}>
        <APIProvider apiKey={GOOGLE_MAPS_KEY}>
          <Map
            defaultCenter={center}
            defaultZoom={data.jobs.length > 0 ? 12 : 6}
            mapId={GOOGLE_MAP_ID}
            style={{ width: "100%", height: "100%" }}
            gestureHandling="greedy"
            disableDefaultUI={false}
          >
            {/* Job site markers */}
            {data.jobs.map((job: any) => (
              <AdvancedMarker
                key={`job-${job.id}`}
                position={{ lat: job.lat, lng: job.lng }}
                onClick={() => setSelected({ type: "job", data: job })}
              >
                <Pin background="#3b82f6" borderColor="#1d4ed8" glyphColor="#fff" scale={1.1} />
              </AdvancedMarker>
            ))}

            {/* Installer markers */}
            {installerMarkers.map((m: any) => (
              <AdvancedMarker
                key={`installer-${m.user_id}`}
                position={{ lat: m.lat, lng: m.lng }}
                onClick={() => setSelected({ type: "installer", data: m })}
              >
                <Pin
                  background={m.within_range ? "#00d4a0" : "#f87171"}
                  borderColor={m.within_range ? "#00a87a" : "#dc2626"}
                  glyphColor="#0f1923"
                  scale={1.2}
                />
              </AdvancedMarker>
            ))}

            {/* Info window */}
            {selected && (
              <InfoWindow
                position={selected.type === "job"
                  ? { lat: selected.data.lat, lng: selected.data.lng }
                  : { lat: selected.data.lat, lng: selected.data.lng }
                }
                onCloseClick={() => setSelected(null)}
              >
                <div style={{ padding: 4, minWidth: 160 }}>
                  {selected.type === "job" ? (
                    <>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>{selected.data.name}</div>
                      <div style={{ fontSize: 12, color: "#666" }}>{selected.data.address}</div>
                      <div style={{ fontSize: 12, marginTop: 4, color: "#3b82f6" }}>
                        {data.signins.filter((s: any) => s.job_id === selected.data.id).length} installer(s) on site
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>{selected.data.user?.name}</div>
                      <div style={{ fontSize: 12, color: "#666" }}>{selected.data.job?.name}</div>
                      <div style={{ fontSize: 12, marginTop: 4 }}>
                        {selected.data.within_range
                          ? <span style={{ color: "#00a87a" }}>✓ On site ({Math.round(selected.data.distance_from_site_metres)}m)</span>
                          : <span style={{ color: "#dc2626" }}>⚠ Off site ({Math.round(selected.data.distance_from_site_metres)}m away)</span>
                        }
                      </div>
                      {selected.data.hoursOnSite && (
                        <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>{selected.data.hoursOnSite}h on site</div>
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

      {/* No data message */}
      {installerMarkers.length === 0 && data.jobs.length === 0 && (
        <div style={{ textAlign: "center", padding: 40, color: "#4d6478", fontSize: 14 }}>
          No active jobs or installers on site today
        </div>
      )}
    </div>
  )
}