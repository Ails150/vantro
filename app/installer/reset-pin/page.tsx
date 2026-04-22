"use client"
import { useState, Suspense } from "react"
import { useSearchParams } from "next/navigation"

function ResetPinForm() {
  const params = useSearchParams()
  const token = params.get("token")
  const [pin, setPin] = useState("")
  const [confirm, setConfirm] = useState("")
  const [status, setStatus] = useState<"idle"|"loading"|"success"|"error">("idle")
  const [message, setMessage] = useState("")

  async function handleSubmit() {
    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) { setMessage("PIN must be 4 digits"); return }
    if (pin !== confirm) { setMessage("PINs do not match"); return }
    setStatus("loading")
    const res = await fetch("/api/installer/reset-pin/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, pin })
    })
    const data = await res.json()
    if (res.ok) { setStatus("success"); setMessage("PIN updated! You can now log in with your new PIN.") }
    else { setStatus("error"); setMessage(data.error || "Failed to reset PIN") }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0f1923", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "system-ui,sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ width: 56, height: 56, background: "#00d4a0", borderRadius: 14, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 700, color: "#0f1923", marginBottom: 16 }}>V</div>
          <h1 style={{ color: "#fff", fontSize: 22, fontWeight: 700, margin: 0 }}>Set new PIN</h1>
          <p style={{ color: "#4d6478", fontSize: 14, marginTop: 8 }}>Choose a 4-digit PIN for your Vantro account</p>
        </div>
        {status === "success" ? (
          <div style={{ background: "rgba(0,212,160,0.1)", border: "1px solid #00d4a0", borderRadius: 12, padding: 20, textAlign: "center" }}>
            <p style={{ color: "#00d4a0", fontWeight: 600, margin: 0 }}>{message}</p>
          </div>
        ) : (
          <div style={{ background: "#1a2635", borderRadius: 16, padding: 24 }}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ color: "#4d6478", fontSize: 12, fontWeight: 600, display: "block", marginBottom: 6 }}>NEW PIN</label>
              <input value={pin} onChange={e => setPin(e.target.value.replace(/\D/g,"").slice(0,4))} type="password" inputMode="numeric" maxLength={4} placeholder="4 digits"
                style={{ width: "100%", padding: "10px 12px", background: "#0f1923", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "#fff", fontSize: 20, letterSpacing: 8, boxSizing: "border-box" }} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ color: "#4d6478", fontSize: 12, fontWeight: 600, display: "block", marginBottom: 6 }}>CONFIRM PIN</label>
              <input value={confirm} onChange={e => setConfirm(e.target.value.replace(/\D/g,"").slice(0,4))} type="password" inputMode="numeric" maxLength={4} placeholder="4 digits"
                style={{ width: "100%", padding: "10px 12px", background: "#0f1923", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "#fff", fontSize: 20, letterSpacing: 8, boxSizing: "border-box" }} />
            </div>
            {message && <p style={{ color: status === "error" ? "#f87171" : "#4d6478", fontSize: 13, marginBottom: 12 }}>{message}</p>}
            <button onClick={handleSubmit} disabled={status === "loading"}
              style={{ width: "100%", padding: 12, background: "#00d4a0", color: "#0f1923", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: "pointer", opacity: status === "loading" ? 0.6 : 1 }}>
              {status === "loading" ? "Saving..." : "Set new PIN →"}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function ResetPin() {
  return <Suspense><ResetPinForm /></Suspense>
}