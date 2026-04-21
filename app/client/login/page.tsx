"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"

export default function ClientLogin() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function login() {
    if (!email || !password) { setError("Please enter your email and password"); return }
    setLoading(true); setError("")
    const res = await fetch("/api/client", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "login", email, password }) })
    const data = await res.json()
    if (!res.ok) { setError(data.error); setLoading(false); return }
    localStorage.setItem("vantro_client_token", data.token)
    localStorage.setItem("vantro_client_name", data.name)
    router.push("/client/portal")
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0f1923", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ width: 64, height: 64, background: "#00d4a0", borderRadius: 16, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 32, fontWeight: 700, color: "#0f1923", marginBottom: 16 }}>V</div>
          <h1 style={{ color: "#fff", fontSize: 24, fontWeight: 700, margin: 0 }}>Job Portal</h1>
          <p style={{ color: "#4d6478", fontSize: 14, marginTop: 8 }}>View your job progress and reports</p>
        </div>
        <div style={{ background: "#1a2635", borderRadius: 16, padding: 24 }}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ color: "#4d6478", fontSize: 12, fontWeight: 600, display: "block", marginBottom: 6 }}>EMAIL</label>
            <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="your@email.com"
              style={{ width: "100%", padding: "10px 12px", background: "#0f1923", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "#fff", fontSize: 14, boxSizing: "border-box" }} />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ color: "#4d6478", fontSize: 12, fontWeight: 600, display: "block", marginBottom: 6 }}>PASSWORD</label>
            <input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="••••••••"
              onKeyDown={e => e.key === "Enter" && login()}
              style={{ width: "100%", padding: "10px 12px", background: "#0f1923", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "#fff", fontSize: 14, boxSizing: "border-box" }} />
          </div>
          {error && <p style={{ color: "#f87171", fontSize: 13, marginBottom: 12 }}>{error}</p>}
          <button onClick={login} disabled={loading}
            style={{ width: "100%", padding: "12px", background: "#00d4a0", color: "#0f1923", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: "pointer", opacity: loading ? 0.6 : 1 }}>
            {loading ? "Signing in..." : "Sign in →"}
          </button>
        </div>
        <p style={{ color: "#4d6478", fontSize: 12, textAlign: "center", marginTop: 16 }}>Powered by Vantro — getvantro.com</p>
      </div>
    </div>
  )
}