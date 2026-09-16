"use client"
import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { safeNextPath } from "@/lib/safe-redirect"

/**
 * Step up a signed-in session to aal2 by entering a code.
 *
 * The middleware sends people here and passes ?next= so they land back where
 * they were going. Losing that destination is a small thing that makes the
 * whole feature feel like an obstacle rather than a door.
 *
 * All of this runs against the browser Supabase client. MFA challenge and
 * verify are designed to be called that way, the code never passes through our
 * server, and adding an API route in the middle would give us a place to
 * accidentally log a one-time code.
 */
export default function VerifyMfaPage() {
  const [code, setCode] = useState("")
  const [factorId, setFactorId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recoveryMode, setRecoveryMode] = useState(false)
  const [recoveryCode, setRecoveryCode] = useState("")
  const [redeeming, setRedeeming] = useState(false)

  async function redeem(e: React.FormEvent) {
    e.preventDefault()
    setRedeeming(true)
    setError(null)
    try {
      const res = await fetch("/api/security/recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: recoveryCode }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error || "That code was not recognised")
        setRedeeming(false)
        return
      }
      // The factor is gone. A role that requires one gets sent to enrol by the
      // policy; an ordinary admin simply carries on without one.
      window.location.assign("/security/enrol?next=/admin")
    } catch (err: any) {
      setError(err?.message || "Could not check that code")
      setRedeeming(false)
    }
  }

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.mfa.listFactors().then(({ data, error }) => {
      if (error) { setError(error.message); setLoading(false); return }
      const totp = data?.totp?.[0]
      if (!totp) {
        // Nothing to verify against. Rather than stranding them on a form with
        // no factor behind it, send them to set one up.
        window.location.assign("/security/enrol")
        return
      }
      setFactorId(totp.id)
      setLoading(false)
    })
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!factorId) return
    setVerifying(true)
    setError(null)

    const supabase = createClient()
    const challenge = await supabase.auth.mfa.challenge({ factorId })
    if (challenge.error) {
      setError(challenge.error.message)
      setVerifying(false)
      return
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.data.id,
      code: code.trim(),
    })

    if (verifyError) {
      // Deliberately not distinguishing "wrong code" from "expired code". Both
      // mean try again with the current one, and the difference is only useful
      // to somebody guessing.
      setError("That code was not accepted. Check the app and try the current code.")
      setCode("")
      setVerifying(false)
      return
    }

    // Full navigation, not a soft push: the session cookie has just been
    // upgraded and the next request has to carry it.
    // startsWith("/") is not enough: "//evil.example.com" starts with "/" and
    // is a protocol-relative URL that the browser resolves to another host.
    const next = new URLSearchParams(window.location.search).get("next")
    window.location.assign(safeNextPath(next))
  }

  return (
    <div className="min-h-screen bg-[#0f1923] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-bold text-white mb-2">Enter your code</h1>
        <p className="text-sm text-gray-400 mb-6">
          Open your authenticator app and enter the six-digit code for Vantro.
        </p>

        {loading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <input
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              placeholder="000000"
              className="w-full rounded-lg bg-[#1a2733] border border-[#2a3a4a] px-4 py-3 text-center text-2xl tracking-[0.3em] text-white placeholder:text-gray-600 focus:border-[#00d4a0] focus:outline-none"
            />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={verifying || code.length !== 6}
              className="w-full rounded-lg bg-[#00d4a0] py-3 font-bold text-[#0f1923] disabled:opacity-50"
            >
              {verifying ? "Checking…" : "Verify"}
            </button>
          </form>
        )}

        {/* The lost-phone path. Redeeming a code does NOT let somebody in
            without a second factor -- it deletes the authenticator, and a role
            that requires one is sent straight to enrol a new one. */}
        {!loading && (
          <div className="mt-8 border-t border-[#2a3a4a] pt-6">
            {!recoveryMode ? (
              <button
                type="button"
                onClick={() => { setRecoveryMode(true); setError(null) }}
                className="text-xs text-gray-400 underline hover:text-gray-200"
              >
                Lost your phone? Use a recovery code
              </button>
            ) : (
              <form onSubmit={redeem} className="space-y-3">
                <p className="text-xs text-gray-400">
                  Enter one of the codes you saved when you set this up. It works
                  once, and it removes the authenticator so you can set up a new
                  one.
                </p>
                <input
                  value={recoveryCode}
                  onChange={e => setRecoveryCode(e.target.value)}
                  autoComplete="off"
                  placeholder="XXXXX-XXXXX"
                  className="w-full rounded-lg bg-[#1a2733] border border-[#2a3a4a] px-4 py-3 text-center font-mono tracking-widest text-white placeholder:text-gray-600 focus:border-[#00d4a0] focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={redeeming || recoveryCode.trim().length < 10}
                  className="w-full rounded-lg border border-[#2a3a4a] py-2.5 text-sm font-bold text-white disabled:opacity-50"
                >
                  {redeeming ? "Checking…" : "Use recovery code"}
                </button>
                <button
                  type="button"
                  onClick={() => { setRecoveryMode(false); setError(null) }}
                  className="w-full text-xs text-gray-500"
                >
                  Back to the code from my app
                </button>
              </form>
            )}
          </div>
        )}

        <p className="mt-6 text-xs text-gray-500">
          No codes either? Another administrator can clear two-factor on your
          account — see docs/security/MFA-RESET.md.
        </p>
      </div>
    </div>
  )
}
