"use client"
import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"

export default function ClientPortal() {
  const router = useRouter()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState("activity")
  const [name, setName] = useState("")

  useEffect(() => {
    const token = localStorage.getItem("vantro_client_token")
    const clientName = localStorage.getItem("vantro_client_name")
    if (!token) { router.push("/client/login"); return }
    setName(clientName || "")
    fetch("/api/client/portal", { headers: { "Authorization": `Bearer ${token}` } })
      .then(r => { if (r.status === 401) { router.push("/client/login"); return null } return r.json() })
      .then(d => { if (d) setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  if (loading) return <div style={{ minHeight: "100vh", background: "#0f1923", display: "flex", alignItems: "center", justifyContent: "center" }}><div style={{ color: "#00d4a0", fontSize: 16 }}>Loading your portal...</div></div>
  if (!data) return null

  const tabs = [{ id: "activity", label: "Activity" }, { id: "attendance", label: "Attendance" }, { id: "qa", label: "QA" }]

  return (
    <div style={{ minHeight: "100vh", background: "#0f1923", fontFamily: "system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ background: "#1a2635", borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, background: "#00d4a0", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: "#0f1923" }}>V</div>
          <div>
            <div style={{ color: "#fff", fontWeight: 700, fontSize: 15 }}>{data.job?.name}</div>
            <div style={{ color: "#4d6478", fontSize: 12 }}>{data.job?.address}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ color: "#4d6478", fontSize: 13 }}>Hi, {name}</span>
          <button onClick={() => { localStorage.removeItem("vantro_client_token"); router.push("/client/login") }}
            style={{ background: "none", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#4d6478", padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>Sign out</button>
        </div>
      </div>

      {/* Status bar */}
      <div style={{ background: data.job?.status === "active" ? "rgba(0,212,160,0.08)" : "rgba(77,100,120,0.2)", borderBottom: "1px solid rgba(255,255,255,0.04)", padding: "10px 24px", display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: data.job?.status === "active" ? "#00d4a0" : "#4d6478" }}></div>
        <span style={{ color: data.job?.status === "active" ? "#00d4a0" : "#4d6478", fontSize: 13, fontWeight: 600 }}>{data.job?.status === "active" ? "Job in progress" : "Job completed"}</span>
        <span style={{ color: "#4d6478", fontSize: 13, marginLeft: 8 }}>· {data.signins?.length || 0} site visits · {data.diary?.length || 0} diary entries</span>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, padding: "16px 24px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            style={{ padding: "8px 16px", background: activeTab === t.id ? "#00d4a0" : "none", color: activeTab === t.id ? "#0f1923" : "#4d6478", border: "none", borderRadius: "8px 8px 0 0", fontWeight: activeTab === t.id ? 700 : 400, fontSize: 14, cursor: "pointer" }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ padding: 24, maxWidth: 800, margin: "0 auto" }}>

        {/* Activity Tab */}
        {activeTab === "activity" && (
          <div>
            <h3 style={{ color: "#fff", fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Site Diary</h3>
            {data.diary?.length === 0 && <p style={{ color: "#4d6478" }}>No diary entries yet.</p>}
            {data.diary?.map((e: any) => (
              <div key={e.id} style={{ background: "#1a2635", borderRadius: 12, padding: 16, marginBottom: 10, borderLeft: e.ai_alert_type === "blocker" ? "3px solid #f87171" : e.ai_alert_type === "issue" ? "3px solid #fbbf24" : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ color: "#00d4a0", fontSize: 12, fontWeight: 600 }}>{e.users?.name}</span>
                  <span style={{ color: "#4d6478", fontSize: 11 }}>{new Date(e.created_at).toLocaleString("en-GB")}</span>
                </div>
                {e.entry_text && e.entry_text !== "📷 Photo entry" && <p style={{ color: "#fff", fontSize: 14, margin: "0 0 8px" }}>{e.entry_text}</p>}
                {e.photo_urls && e.photo_urls.length > 0 && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {e.photo_urls.map((url: string, i: number) => (
                      <a key={i} href={url} target="_blank" rel="noreferrer">
                        <img src={url} style={{ width: 80, height: 80, borderRadius: 8, objectFit: "cover" }} />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Attendance Tab */}
        {activeTab === "attendance" && (
          <div>
            <h3 style={{ color: "#fff", fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Site Attendance</h3>
            {data.signins?.length === 0 && <p style={{ color: "#4d6478" }}>No sign-ins recorded yet.</p>}
            {data.signins?.map((s: any, i: number) => {
              const inTime = new Date(s.signed_in_at)
              const outTime = s.signed_out_at ? new Date(s.signed_out_at) : null
              const hours = outTime ? ((outTime.getTime() - inTime.getTime()) / 3600000).toFixed(1) : null
              return (
                <div key={i} style={{ background: "#1a2635", borderRadius: 12, padding: 16, marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ color: "#fff", fontWeight: 600, fontSize: 14 }}>{s.users?.name}</div>
                    <div style={{ color: "#4d6478", fontSize: 12, marginTop: 4 }}>
                      In: {inTime.toLocaleString("en-GB")} {outTime ? `· Out: ${outTime.toLocaleString("en-GB")}` : "· Still on site"}
                    </div>
                  </div>
                  {hours && <div style={{ color: "#00d4a0", fontWeight: 700, fontSize: 16 }}>{hours}h</div>}
                </div>
              )
            })}
          </div>
        )}

        {/* QA Tab */}
        {activeTab === "qa" && (
          <div>
            <h3 style={{ color: "#fff", fontSize: 16, fontWeight: 700, marginBottom: 16 }}>QA Sign-offs</h3>
            {data.qa?.length === 0 && <p style={{ color: "#4d6478" }}>No QA responses yet.</p>}
            {data.qa?.map((q: any, i: number) => (
              <div key={i} style={{ background: "#1a2635", borderRadius: 12, padding: 16, marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ color: "#fff", fontSize: 14 }}>{q.checklist_items?.label}</div>
                  <div style={{ color: "#4d6478", fontSize: 12, marginTop: 2 }}>{q.users?.name} · {new Date(q.created_at).toLocaleString("en-GB")}</div>
                </div>
                <div style={{ color: q.result === "pass" ? "#00d4a0" : "#f87171", fontWeight: 700, fontSize: 13 }}>{q.result?.toUpperCase()}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ textAlign: "center", padding: "24px", color: "#4d6478", fontSize: 12 }}>
        Powered by Vantro — getvantro.com
      </div>
    </div>
  )
}