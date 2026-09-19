"use client"

// The signing half of the public variation page.
//
// Strokes are captured as numbers in the pad's own 600 x 200 space and sent as
// numbers. The server draws the SVG (see app/api/variations/sign) so nothing
// this page produces is ever stored as markup.

import { useRef, useState } from "react"
import { PAD_H, PAD_W } from "@/lib/variations"

type Stroke = Array<[number, number]>

export default function SignForm({ token, amount, reference }: { token: string; amount: string; reference: string }) {
  const [mode, setMode] = useState<"sign" | "decline">("sign")
  const [name, setName] = useState("")
  const [position, setPosition] = useState("")
  const [reason, setReason] = useState("")
  const [agree, setAgree] = useState(false)
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<null | { decision: string; at: string }>(null)
  const drawing = useRef<Stroke | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  function point(e: React.PointerEvent): [number, number] {
    const r = svgRef.current!.getBoundingClientRect()
    const x = Math.min(PAD_W, Math.max(0, ((e.clientX - r.left) / r.width) * PAD_W))
    const y = Math.min(PAD_H, Math.max(0, ((e.clientY - r.top) / r.height) * PAD_H))
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10]
  }

  function down(e: React.PointerEvent) {
    e.preventDefault()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    drawing.current = [point(e)]
    setStrokes(s => [...s, drawing.current!])
  }
  function move(e: React.PointerEvent) {
    if (!drawing.current) return
    drawing.current.push(point(e))
    setStrokes(s => [...s.slice(0, -1), [...drawing.current!]])
  }
  function up() {
    drawing.current = null
  }

  async function submit() {
    setError(null)
    if (name.trim().length < 2) return setError("Type your full name.")
    if (mode === "sign") {
      if (strokes.reduce((n, s) => n + s.length, 0) < 8) return setError("Draw your signature in the box.")
      if (!agree) return setError(`Tick the box to confirm you agree ${amount}.`)
    } else if (!reason.trim()) {
      return setError("Say why you are declining, so it can be put right.")
    }
    setBusy(true)
    try {
      const res = await fetch("/api/variations/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          decision: mode === "sign" ? "signed" : "declined",
          name: name.trim(),
          position: position.trim(),
          strokes: mode === "sign" ? strokes : undefined,
          reason: mode === "decline" ? reason.trim() : undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || "That did not go through. Please try again.")
      } else {
        setDone({ decision: data.decision, at: data.decidedAt })
      }
    } catch {
      setError("No connection. Please try again.")
    }
    setBusy(false)
  }

  if (done) {
    return (
      <div>
        <p className={`text-sm font-medium ${done.decision === "signed" ? "text-ok" : "text-warn"}`}>
          {done.decision === "signed" ? `${reference} signed.` : `${reference} declined.`}
        </p>
        <p className="mt-1 text-sm text-ink-muted">
          Recorded {new Date(done.at).toLocaleString("en-GB", { timeZone: "Europe/London" })}. You can close this page.
        </p>
      </div>
    )
  }

  const inputCls = "mt-1 w-full rounded-lg border border-line-strong bg-canvas px-3 py-2 text-[15px] outline-none focus:border-accent"

  return (
    <div>
      <div className="mb-4 flex gap-2" role="tablist">
        {(["sign", "decline"] as const).map(m => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => { setMode(m); setError(null) }}
            className={`rounded-lg px-3 py-1.5 text-sm ${mode === m ? "bg-ink text-canvas" : "border border-line text-ink-muted"}`}
          >
            {m === "sign" ? "Sign" : "Decline"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-sm">
          Full name
          <input className={inputCls} value={name} onChange={e => setName(e.target.value)} autoComplete="name" maxLength={200} />
        </label>
        <label className="text-sm">
          Position <span className="text-ink-subtle">(optional)</span>
          <input className={inputCls} value={position} onChange={e => setPosition(e.target.value)} autoComplete="organization-title" maxLength={200} />
        </label>
      </div>

      {mode === "sign" ? (
        <>
          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm">Signature</p>
            <button type="button" onClick={() => setStrokes([])} className="text-xs text-ink-muted underline">
              Clear
            </button>
          </div>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${PAD_W} ${PAD_H}`}
            className="mt-1 w-full touch-none rounded-lg border border-line-strong bg-canvas"
            style={{ aspectRatio: `${PAD_W} / ${PAD_H}` }}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerLeave={up}
            onPointerCancel={up}
            aria-label="Signature pad"
            role="img"
          >
            {strokes.map((s, i) => (
              <polyline
                key={i}
                points={s.map(p => p.join(",")).join(" ")}
                fill="none"
                stroke="#0A1A14"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          </svg>
          <label className="mt-4 flex items-start gap-2 text-sm">
            <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} className="mt-1" />
            <span>
              I agree {reference} at <strong>{amount}</strong> as described above, and I am authorised to sign it.
            </span>
          </label>
        </>
      ) : (
        <label className="mt-4 block text-sm">
          Why are you declining?
          <textarea className={`${inputCls} min-h-[96px]`} value={reason} onChange={e => setReason(e.target.value)} maxLength={4000} />
        </label>
      )}

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      <button
        type="button"
        disabled={busy}
        onClick={submit}
        className={`mt-4 w-full rounded-lg px-4 py-3 text-sm font-semibold ${
          mode === "sign" ? "bg-accent text-[#07100D]" : "bg-ink text-canvas"
        } disabled:opacity-60`}
      >
        {busy ? "Recording..." : mode === "sign" ? `Sign ${reference}` : `Decline ${reference}`}
      </button>
    </div>
  )
}
