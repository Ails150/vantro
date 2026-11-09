"use client"
import { useCallback, useEffect, useState } from "react"
import { Section } from "@/components/ui/Page"

const SCHEMES = [
  { id: "certass", label: "Certass" },
  { id: "fensa", label: "FENSA" },
] as const

const inp =
  "w-full rounded-md border border-line-strong bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-ink/20"

/** Settings > Schemes. A key is only saved after the scheme has accepted it. */
export default function SchemesSection() {
  const [state, setState] = useState<any>(null)
  const [gated, setGated] = useState(false)

  const load = useCallback(() => {
    fetch("/api/admin/schemes").then(async r => {
      if (r.status === 402) return setGated(true)
      if (r.ok) setState(await r.json())
    }).catch(() => {})
  }, [])
  useEffect(load, [load])

  if (gated) {
    return (
      <Section title="Schemes">
        <p className="text-sm text-ink-subtle">Certass and FENSA registration is on the Full Suite plan.</p>
      </Section>
    )
  }
  if (!state) return null

  return (
    <Section title="Schemes">
      <div className="space-y-6">
        {SCHEMES.map(s => (
          <SchemeRow
            key={s.id}
            scheme={s.id}
            label={s.label}
            connection={state.connections.find((c: any) => c.scheme === s.id)}
            availability={state.availability[s.id]}
            onChanged={load}
          />
        ))}
      </div>
    </Section>
  )
}

function SchemeRow({ scheme, label, connection, availability, onChanged }: any) {
  const [apiKey, setApiKey] = useState("")
  const [memberNumber, setMemberNumber] = useState(connection?.member_number || "")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  async function validate() {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch("/api/admin/schemes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheme, apiKey, memberNumber }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage({ ok: false, text: body.error || `Could not validate (${res.status})` })
      } else {
        setApiKey("")
        setMessage({ ok: true, text: "Validated and saved." })
        onChanged()
      }
    } catch (e: any) {
      setMessage({ ok: false, text: e?.message || "Could not validate" })
    }
    setBusy(false)
  }

  async function disconnect() {
    setBusy(true)
    await fetch(`/api/admin/schemes?scheme=${scheme}`, { method: "DELETE" }).catch(() => {})
    setBusy(false)
    setMessage(null)
    onChanged()
  }

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="text-sm font-bold text-ink">{label}</h4>
        {connection?.active && (
          <span className="text-xs text-accent-ink">Connected, key ending {connection.api_key_last4}</span>
        )}
      </div>

      {!availability?.available ? (
        <p className="text-xs text-ink-subtle mt-1">{availability?.reason}</p>
      ) : (
        <>
          {availability.environment === "simulator" && (
            <p className="text-xs text-warning mt-1">
              Test mode. Nothing is sent to {label}, and certificate numbers start SIM.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div>
              <label className="block text-xs font-medium text-ink mb-1">API key</label>
              <input type="password" autoComplete="off" value={apiKey} onChange={e => setApiKey(e.target.value)} className={inp} />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink mb-1">Member number</label>
              <input value={memberNumber} onChange={e => setMemberNumber(e.target.value)} className={inp} />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={validate}
              disabled={busy || !apiKey.trim() || !memberNumber.trim()}
              className="bg-accent hover:bg-accent-ink text-white font-bold rounded-md px-4 py-2 text-sm disabled:opacity-50"
            >
              {busy ? "Validating..." : "Validate"}
            </button>
            {connection && (
              <button type="button" onClick={disconnect} disabled={busy} className="text-xs text-ink-subtle underline hover:text-ink">
                Disconnect
              </button>
            )}
          </div>
        </>
      )}
      {message && <p className={"text-sm mt-2 " + (message.ok ? "text-accent-ink" : "text-danger")}>{message.text}</p>}
    </div>
  )
}
