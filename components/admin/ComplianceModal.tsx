"use client"

import { useEffect, useState } from "react"

interface Props {
  open: boolean
  onClose: () => void
}

interface ComplianceData {
  company: {
    id: string
    name: string
    dpa_accepted_at: string | null
    dpa_accepted_by_name: string | null
    dpa_version: string | null
  }
  canAccept: boolean
}

const DOCS = [
  { file: "Vantro_Privacy_Policy.pdf", title: "Privacy Policy", desc: "Our full privacy policy under UK GDPR." },
  { file: "Vantro_Data_Processing_Agreement.pdf", title: "Data Processing Agreement", desc: "DPA naming you as Controller and Vantro as Processor." },
  { file: "Vantro_GPS_Tracking_Explainer.pdf", title: "GPS Tracking Explainer", desc: "For installers. Plain English on how tracking works." },
  { file: "Vantro_Installer_HowTo_Guide.pdf", title: "Installer How-To Guide", desc: "One-page practical walkthrough." },
  { file: "Vantro_GDPR_QuickRef_for_Andy.pdf", title: "GDPR Quick-Reference", desc: "Talking points for managers briefing the team." },
]

const SUB_PROCESSORS: Array<[string, string, string]> = [
  ["Supabase", "Database, auth, storage", "EU (Frankfurt)"],
  ["Cloudflare R2", "Photo, receipt, video storage", "EU"],
  ["Cloudflare Stream", "Walk & Talk video delivery", "EU"],
  ["Resend", "Transactional email", "EU"],
  ["Google Cloud (Gemini)", "AI summaries, OCR, diary analysis", "Multi-region"],
  ["Vercel", "Web hosting", "Multi-region"],
  ["Sentry", "Error monitoring", "EU"],
  ["Stripe", "Payments (PCI-DSS L1)", "Multi-region"],
  ["Google Maps", "Address geocoding", "Multi-region"],
  ["Apple Push Notification Service", "iOS push notifications", "US"],
  ["Firebase Cloud Messaging", "Android push notifications", "US"],
]

export default function ComplianceModal({ open, onClose }: Props) {
  const [data, setData] = useState<ComplianceData | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/account/compliance")
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Failed to load")
      setData(json)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) load()
  }, [open])

  async function acceptDPA() {
    if (!data) return
    if (!confirm(`Confirm: by clicking accept you are accepting the Vantro Data Processing Agreement on behalf of ${data.company.name}. This will be logged with your name and the date. Continue?`)) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/account/accept-dpa", { method: "POST" })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Failed")
      await load()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  const accepted = data?.company?.dpa_accepted_at
  const acceptedDate = accepted ? new Date(accepted).toLocaleDateString("en-GB") : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Compliance</h2>
            <p className="text-xs text-gray-500 mt-0.5">Legal documents, GDPR pack, and your Data Processing Agreement.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading && <p className="text-sm text-gray-500">Loading…</p>}

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</p>}

          {data && (
            <>
              {/* DPA acceptance */}
              {accepted ? (
                <div className="flex items-start gap-3 p-3 mb-5 bg-green-50 border border-green-200 rounded-xl">
                  <div className="text-green-700 text-lg leading-none mt-0.5">✓</div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-green-900">
                      DPA accepted on {acceptedDate}{data.company.dpa_accepted_by_name ? " by " + data.company.dpa_accepted_by_name : ""}
                    </p>
                    <p className="text-xs text-green-700 mt-0.5">
                      Version {data.company.dpa_version || "1.0"}. This record is your evidence of compliance.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3 p-3 mb-5 bg-orange-50 border border-orange-200 rounded-xl">
                  <div className="text-orange-700 text-lg leading-none mt-0.5">!</div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-orange-900">DPA not yet accepted</p>
                    <p className="text-xs text-orange-700 mt-0.5 mb-2">
                      Download and review the DPA below, then click accept on behalf of {data.company.name}.
                    </p>
                    {data.canAccept ? (
                      <button
                        onClick={acceptDPA}
                        disabled={busy}
                        className="px-3 py-1.5 bg-teal-500 hover:bg-teal-600 text-white text-sm font-medium rounded-lg disabled:opacity-50"
                      >
                        {busy ? "Saving…" : "I accept the DPA"}
                      </button>
                    ) : (
                      <p className="text-xs text-orange-700 italic">Only an admin can accept the DPA.</p>
                    )}
                  </div>
                </div>
              )}

              {/* Documents */}
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Documents</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-5">
                {DOCS.map((doc) => (
                  <a
                    key={doc.file}
                    href={"/legal/" + doc.file} target="_blank" rel="noopener" className="flex items-start gap-3 p-3 border border-gray-200 rounded-xl hover:border-teal-300 hover:bg-teal-50/30 transition-colors"
                  >
                    <div className="text-teal-600 text-base mt-0.5">⤓</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">{doc.title}</p>
                      <p className="text-xs text-gray-600 mt-0.5">{doc.desc}</p>
                    </div>
                  </a>
                ))}
              </div>

              {/* Rollout tip */}
              <div className="p-3 mb-5 bg-blue-50 border border-blue-200 rounded-xl">
                <p className="text-xs text-blue-900">
                  <span className="font-semibold">Rollout tip:</span> Send the GPS Tracking Explainer and the Installer How-To Guide to every installer before they start using Vantro. The Andy Quick-Ref is the script for the office manager doing the briefing.
                </p>
              </div>

              {/* Sub-processors */}
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Sub-processors</h3>
              <p className="text-xs text-gray-600 mb-2">Third-party services Vantro uses to deliver the platform. Documented in the DPA.</p>
              <div className="border border-gray-200 rounded-xl overflow-hidden mb-5">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-700 text-xs uppercase tracking-wider">Sub-processor</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-700 text-xs uppercase tracking-wider">Purpose</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-700 text-xs uppercase tracking-wider">Region</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {SUB_PROCESSORS.map(([name, purpose, region]) => (
                      <tr key={name}>
                        <td className="px-3 py-2 font-medium text-gray-900">{name}</td>
                        <td className="px-3 py-2 text-gray-700">{purpose}</td>
                        <td className="px-3 py-2 text-gray-500 text-xs">{region}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Security */}
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Security at a glance</h3>
              <ul className="text-sm text-gray-700 space-y-1 mb-5 list-disc list-inside">
                <li>All data encrypted in transit (TLS 1.2+) and at rest (AES-256)</li>
                <li>Row-level tenant isolation between every customer&apos;s data</li>
                <li>Daily automated backups with 30-day retention</li>
                <li>Audit logging of admin actions</li>
                <li>Rate limiting on authentication and AI endpoints</li>
                <li>72-hour breach notification commitment</li>
                <li>EU-region primary infrastructure</li>
              </ul>

              <div className="pt-4 border-t border-gray-100 text-xs text-gray-500 space-y-0.5">
                <p>Current document version: <span className="font-medium text-gray-700">1.0</span></p>
                <p>Effective from: <span className="font-medium text-gray-700">20 May 2026</span></p>
                <p>Questions: <a href="mailto:aileen@applyscale8.com" className="text-teal-600 hover:underline">aileen@applyscale8.com</a></p>
              </div>
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-50 rounded-lg">Close</button>
        </div>
      </div>
    </div>
  )
}
