"use client"

/**
 * Join a team from a shared link.
 *
 * The whole free-tier worker onboarding is this page: tap the link, type your
 * name, you are in. No password to invent, no PIN to remember, no email to go
 * and check on a phone with one bar of signal in a site cabin.
 *
 * The session it hands out is long-lived on purpose -- this worker has no
 * other way back in, so making them find the original WhatsApp message every
 * morning would be the same as not onboarding them at all.
 */

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"

const BG = "#0f1923"
const CARD = "#1a2635"
const ACCENT = "#00d4a0"
const MUTED = "#8fa3b8"

export default function JoinPage() {
  const params = useParams<{ token: string }>()
  const router = useRouter()
  const token = params?.token

  const [companyName, setCompanyName] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!token) return
    let alive = true
    ;(async () => {
      try {
        const res = await fetch(`/api/join?token=${encodeURIComponent(token)}`)
        const data = await res.json().catch(() => ({}))
        if (!alive) return
        if (!res.ok) setError(data?.error || "This invite link is not valid.")
        else setCompanyName(data.companyName)
      } catch {
        if (alive) setError("Could not reach Vantro. Check your connection.")
      } finally {
        if (alive) setChecking(false)
      }
    })()
    return () => { alive = false }
  }, [token])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError("")
    try {
      const res = await fetch("/api/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name, email }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error || "Could not add you to the team.")
        return
      }
      // Same key the installer views already read, so the worker lands on the
      // jobs list already signed in rather than on the PIN screen.
      localStorage.setItem("vantro_installer_token", data.token)
      router.replace("/installer/jobs")
    } catch {
      setError("Could not reach Vantro. Check your connection.")
    } finally {
      setSubmitting(false)
    }
  }

  const ready = !checking && !!companyName

  return (
    <div style={{ minHeight: "100vh", background: BG, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 28 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: ACCENT, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ color: BG, fontWeight: 800 }}>V</span>
          </div>
          <span style={{ color: "#fff", fontSize: 20, fontWeight: 600 }}>Vantro</span>
        </div>

        {checking ? (
          <p style={{ color: MUTED, fontSize: 14 }}>Checking your invite…</p>
        ) : !ready ? (
          <div style={{ background: CARD, borderRadius: 16, padding: 24 }}>
            <h1 style={{ color: "#fff", fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
              This link will not work
            </h1>
            <p style={{ color: MUTED, fontSize: 14, lineHeight: 1.6 }}>{error}</p>
          </div>
        ) : (
          <form onSubmit={submit} style={{ background: CARD, borderRadius: 16, padding: 24 }}>
            <h1 style={{ color: "#fff", fontSize: 20, fontWeight: 600, marginBottom: 6 }}>
              Join {companyName}
            </h1>
            <p style={{ color: MUTED, fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
              Add your name and you are in. You will stay signed in on this phone.
            </p>

            <label style={{ display: "block", color: MUTED, fontSize: 13, marginBottom: 6 }}>
              Your name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Dan Whitmore"
              autoFocus
              required
              disabled={submitting}
              style={{ width: "100%", background: "#243040", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 12, padding: "12px 14px", color: "#fff", fontSize: 15, marginBottom: 16 }}
            />

            <label style={{ display: "block", color: MUTED, fontSize: 13, marginBottom: 6 }}>
              Email <span style={{ opacity: 0.7 }}>(optional)</span>
            </label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="dan@example.com"
              disabled={submitting}
              style={{ width: "100%", background: "#243040", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 12, padding: "12px 14px", color: "#fff", fontSize: 15, marginBottom: 8 }}
            />
            {/* Optional, but it is what lets someone get back in on a new phone
                without being added to the team twice. */}
            <p style={{ color: MUTED, fontSize: 12, opacity: 0.8, marginBottom: 20 }}>
              Only used to find your account again if you change phone.
            </p>

            {error && (
              <p style={{ color: "#f87171", fontSize: 14, marginBottom: 16 }}>{error}</p>
            )}

            <button
              type="submit"
              disabled={submitting || name.trim().length < 2}
              style={{ width: "100%", background: ACCENT, color: BG, border: "none", borderRadius: 12, padding: "14px 16px", fontSize: 16, fontWeight: 700, cursor: submitting ? "default" : "pointer", opacity: submitting || name.trim().length < 2 ? 0.6 : 1 }}
            >
              {submitting ? "Joining…" : "Join the team"}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
