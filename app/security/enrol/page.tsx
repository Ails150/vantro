"use client"
import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { safeNextPath } from "@/lib/safe-redirect"

/**
 * Set up an authenticator.
 *
 * Reached two ways: voluntarily from Settings by an admin, and compulsorily by
 * a superadmin or support user who has none. The page does not need to know
 * which -- the copy is the same either way, and a screen that scolds somebody
 * for arriving is a screen people put off.
 *
 * ENROLMENT IS NOT COMPLETE UNTIL A CODE IS VERIFIED. Supabase creates the
 * factor as `unverified` and only marks it verified once a code from it has
 * been accepted. That distinction is load bearing: lib/mfa.ts counts only
 * verified factors, so somebody who opens this page and closes the tab is not
 * locked out by a factor they can never produce a code for.
 */
export default function EnrolMfaPage() {
  const [qr, setQr] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [factorId, setFactorId] = useState<string | null>(null)
  const [code, setCode] = useState("")
  const [loading, setLoading] = useState(true)
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showSecret, setShowSecret] = useState(false)
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)
  const [recoveryError, setRecoveryError] = useState<string | null>(null)
  // Deliberately gates the way out. Somebody who clicks past this screen has
  // nowhere to get these from again.
  const [savedConfirmed, setSavedConfirmed] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const supabase = createClient()

    async function start() {
      // An already-verified factor means they are in the wrong place: send them
      // to the code prompt instead of creating a second authenticator.
      const existing = await supabase.auth.mfa.listFactors()
      if (existing.data?.totp?.some(f => f.status === "verified")) {
        window.location.assign("/security/verify")
        return
      }

      // Clear out abandoned enrolments first. Supabase refuses a second factor
      // with the same friendly name, so without this a person who closed the
      // tab once can never enrol again.
      for (const stale of existing.data?.totp ?? []) {
        if (stale.status !== "verified") {
          await supabase.auth.mfa.unenroll({ factorId: stale.id })
        }
      }

      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Vantro",
      })
      if (error) { setError(error.message); setLoading(false); return }

      setFactorId(data.id)
      setQr(data.totp.qr_code)
      setSecret(data.totp.secret)
      setLoading(false)
    }

    start()
  }, [])

  async function confirm(e: React.FormEvent) {
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
      setError("That code was not accepted. Check the app and try the current code.")
      setCode("")
      setVerifying(false)
      return
    }

    // Verifying during enrolment also raises this session to aal2, so the
    // recovery codes can be issued immediately -- and this is the only moment
    // they can ever be shown, since only bcrypt hashes are kept.
    try {
      const res = await fetch("/api/security/recovery-codes", { method: "POST" })
      const body = await res.json().catch(() => ({}))
      if (res.ok && Array.isArray(body.codes)) {
        setRecoveryCodes(body.codes)
      } else {
        // The factor IS set up at this point, so this is not a failure of
        // enrolment. Say what happened and let them carry on -- they can issue
        // a set from Settings later.
        setRecoveryError(
          body.error || "Two-factor is on, but the recovery codes could not be generated. You can create them from Settings.",
        )
      }
    } catch {
      setRecoveryError(
        "Two-factor is on, but the recovery codes could not be generated. You can create them from Settings.",
      )
    }
    setVerifying(false)
  }

  function finish() {
    // startsWith("/") is not enough: "//evil.example.com" starts with "/" and
    // is a protocol-relative URL the browser resolves to another host. Same
    // check, same reason, as the verify screen and the auth callback.
    const next = new URLSearchParams(window.location.search).get("next")
    window.location.assign(safeNextPath(next))
  }

  return (
    <div className="min-h-screen bg-[#0f1923] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-bold text-white mb-2">Set up two-factor</h1>
        <p className="text-sm text-gray-400 mb-6">
          Scan this with an authenticator app — Google Authenticator, 1Password,
          Authy, whichever you already use — then enter the code it shows.
        </p>

        {loading && <p className="text-sm text-gray-400">Preparing…</p>}

        {/* Once the codes exist, they are the ONLY thing on screen. Leaving the
            QR and the form visible underneath invites somebody to treat this as
            a confirmation notice and click away from the one page that will
            ever show them these ten strings. */}
        {recoveryCodes && (
          <div>
            <h2 className="text-lg font-bold text-white mb-2">Save your recovery codes</h2>
            <p className="text-sm text-gray-400 mb-4">
              Two-factor is now on. If you lose your phone, one of these gets you
              back in. Each works once, and{" "}
              <strong className="text-white">this is the only time they are shown</strong> —
              they are stored hashed, so nobody, including us, can read them back
              to you.
            </p>

            <div className="grid grid-cols-2 gap-2 rounded-lg bg-[#1a2733] p-4 font-mono text-sm text-gray-100">
              {recoveryCodes.map(c => <div key={c}>{c}</div>)}
            </div>

            <div className="mt-3 flex gap-3">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(recoveryCodes.join("\n"))
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                }}
                className="text-xs text-[#00d4a0] underline"
              >
                {copied ? "Copied" : "Copy all"}
              </button>
              <a
                href={`data:text/plain;charset=utf-8,${encodeURIComponent(
                  `Vantro two-factor recovery codes\n\nEach code works once.\n\n${recoveryCodes.join("\n")}\n`,
                )}`}
                download="vantro-recovery-codes.txt"
                className="text-xs text-[#00d4a0] underline"
              >
                Download
              </a>
            </div>

            <label className="mt-6 flex items-start gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={savedConfirmed}
                onChange={e => setSavedConfirmed(e.target.checked)}
                className="mt-1"
              />
              <span>I have saved these somewhere I can get to without my phone.</span>
            </label>

            <button
              type="button"
              onClick={finish}
              disabled={!savedConfirmed}
              className="mt-4 w-full rounded-lg bg-[#00d4a0] py-3 font-bold text-[#0f1923] disabled:opacity-50"
            >
              Continue
            </button>
          </div>
        )}

        {!recoveryCodes && recoveryError && (
          <div className="mb-4 rounded-lg border border-amber-600/40 bg-amber-900/20 p-3">
            <p className="text-sm text-amber-300">{recoveryError}</p>
            <button type="button" onClick={finish} className="mt-2 text-xs text-[#00d4a0] underline">
              Continue anyway
            </button>
          </div>
        )}

        {!loading && qr && !recoveryCodes && (
          <>
            {/* Supabase returns the QR as an SVG data URL. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qr}
              alt="Two-factor setup QR code"
              className="w-48 h-48 mx-auto rounded-lg bg-white p-2"
            />

            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => setShowSecret(v => !v)}
                className="text-xs text-gray-400 underline hover:text-gray-200"
              >
                {showSecret ? "Hide setup key" : "Cannot scan it?"}
              </button>
              {showSecret && (
                <p className="mt-2 break-all rounded bg-[#1a2733] p-3 font-mono text-xs text-gray-200">
                  {secret}
                </p>
              )}
            </div>

            <form onSubmit={confirm} className="mt-6 space-y-4">
              <input
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                className="w-full rounded-lg bg-[#1a2733] border border-[#2a3a4a] px-4 py-3 text-center text-2xl tracking-[0.3em] text-white placeholder:text-gray-600 focus:border-[#00d4a0] focus:outline-none"
              />
              {error && <p className="text-sm text-red-400">{error}</p>}
              <button
                type="submit"
                disabled={verifying || code.length !== 6}
                className="w-full rounded-lg bg-[#00d4a0] py-3 font-bold text-[#0f1923] disabled:opacity-50"
              >
                {verifying ? "Confirming…" : "Confirm"}
              </button>
            </form>

            <p className="mt-6 text-xs text-gray-500">
              Keep the setup key somewhere safe. Without it, losing the phone
              means another administrator has to remove the factor for you.
            </p>
          </>
        )}

        {!loading && !qr && error && <p className="text-sm text-red-400">{error}</p>}
      </div>
    </div>
  )
}
