"use client"
import { useState, useEffect, useCallback } from "react"
import { PageTransition, PageHeader, Section } from "@/components/ui/Page"

/**
 * RAMS per job.
 *
 * The screen leads with the consequence, not the document: an unsigned name
 * here is a person who physically cannot sign in, and saying so plainly is more
 * useful than a red badge. Uploading a revision resets every signature, so the
 * upload form says that before you pick a file rather than after.
 */

type Current = {
  id: string
  version: number
  title: string
  notes: string | null
  documentUrl: string
  sha256: string
  bytes: number | null
  createdAt: string
  uploadedBy: string | null
}

function fmt(ts: string | null) {
  if (!ts) return "—"
  return new Date(ts).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  })
}

export default function RamsTab({ jobs = [] }: { jobs?: Array<{ id: string; name: string }> }) {
  const [jobId, setJobId] = useState(jobs[0]?.id || "")
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState("")
  const [notes, setNotes] = useState("")
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!jobId) { setData(null); return }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/rams?jobId=${encodeURIComponent(jobId)}`)
      const body = await res.json()
      if (!res.ok) setError(body.error || `Could not load (${res.status})`)
      else setData(body)
    } catch (e: any) {
      setError(e?.message || "Could not load")
    }
    setLoading(false)
  }, [jobId])

  useEffect(() => { load() }, [load])

  async function upload() {
    if (!file || !title.trim()) return
    setUploading(true)
    setUploadError(null)
    const form = new FormData()
    form.append("document", file)
    form.append("jobId", jobId)
    form.append("title", title.trim())
    if (notes.trim()) form.append("notes", notes.trim())
    try {
      const res = await fetch("/api/admin/rams", { method: "POST", body: form })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) setUploadError(body.error || `Upload failed (${res.status})`)
      else { setFile(null); setTitle(""); setNotes(""); load() }
    } catch (e: any) {
      setUploadError(e?.message || "Upload failed")
    }
    setUploading(false)
  }

  const inp =
    "w-full rounded-md border border-line-strong bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-ink/20"

  const current: Current | null = data?.current || null
  const outstanding = data?.outstanding || []
  const signed = data?.signed || []

  return (
    <PageTransition>
      <PageHeader
        title="RAMS"
        description="The risk assessment and method statement for each job. Anyone who has not signed the version in force cannot sign in to that job."
      />

      <div className="mb-5 max-w-md">
        <label className="block text-sm font-medium text-ink mb-1">Job</label>
        <select value={jobId} onChange={e => setJobId(e.target.value)} className={inp}>
          <option value="">Choose a job…</option>
          {jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
        </select>
      </div>

      {loading && <div className="text-center py-12 text-ink-subtle">Loading…</div>}
      {error && <div className="text-sm text-danger py-4">{error}</div>}

      {jobId && !loading && !error && (
        <>
          <Section title={current ? `Version ${current.version} — in force` : "No RAMS uploaded"}>
            {current ? (
              <div className="space-y-3 text-sm">
                <div>
                  <p className="font-semibold text-ink">{current.title}</p>
                  <p className="text-xs text-ink-subtle">
                    Uploaded {fmt(current.createdAt)}
                    {current.uploadedBy ? ` by ${current.uploadedBy}` : ""}
                    {current.bytes ? ` · ${(current.bytes / 1024 / 1024).toFixed(1)}MB` : ""}
                  </p>
                </div>
                {current.notes && <p className="text-ink-subtle whitespace-pre-wrap">{current.notes}</p>}
                <p className="text-xs text-ink-subtle font-mono break-all">
                  SHA-256 {current.sha256}
                </p>
                <a
                  href={current.documentUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block text-accent-ink underline text-sm"
                >
                  Open the PDF
                </a>

                <div className="pt-3 border-t border-line">
                  <p className="font-medium text-ink">
                    {signed.length} of {signed.length + outstanding.length} of the assigned crew have signed
                  </p>
                  {outstanding.length > 0 && (
                    <div className="mt-2">
                      <p className="text-xs uppercase tracking-wide text-danger font-semibold mb-1">
                        Cannot sign in until they sign
                      </p>
                      <ul className="text-sm text-ink space-y-0.5">
                        {outstanding.map((o: any) => <li key={o.id}>{o.name}</li>)}
                      </ul>
                    </div>
                  )}
                  {signed.length > 0 && (
                    <details className="mt-2">
                      <summary className="text-xs text-ink-subtle cursor-pointer select-none">
                        Signed by {signed.length}
                      </summary>
                      <ul className="text-sm text-ink-subtle mt-1 space-y-0.5">
                        {signed.map((sg: any) => (
                          <li key={sg.userId}>
                            {sg.name} — {fmt(sg.signedAt)}
                            {sg.readSeconds != null ? ` · open ${sg.readSeconds}s before signing` : ""}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {data?.crewSize === 0 && (
                    <p className="text-xs text-warning mt-2">
                      Nobody is assigned to this job yet, so there is nobody to sign.
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-ink-subtle">
                No method statement has been uploaded for this job, so sign-in is not gated. Upload one below.
              </p>
            )}
          </Section>

          <Section title={current ? `Upload version ${current.version + 1}` : "Upload the RAMS"}>
            <div className="space-y-4 max-w-xl">
              {current && (
                <p className="text-xs text-warning">
                  Uploading a revision retires version {current.version} and clears every signature on it.
                  The whole crew will be blocked from signing in until they read and sign the new version.
                  The old version, its hash and its signatures are kept.
                </p>
              )}
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Title</label>
                <input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  maxLength={200}
                  placeholder="Curtain walling installation — RAMS rev C"
                  className={inp}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">What changed (optional)</label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={3}
                  className={inp}
                  placeholder="Added the revised lifting plan for the atrium bays."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">PDF</label>
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={e => setFile(e.target.files?.[0] || null)}
                  className="text-sm text-ink-subtle"
                />
                <p className="text-xs text-ink-subtle mt-1">PDF only, up to 20MB.</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={upload}
                  disabled={uploading || !file || !title.trim()}
                  className="bg-accent hover:bg-accent-ink text-white font-bold rounded-md px-5 py-2 text-sm transition-colors disabled:opacity-50"
                >
                  {uploading ? "Uploading…" : current ? `Upload version ${current.version + 1}` : "Upload RAMS"}
                </button>
                {uploadError && <span className="text-sm text-danger">{uploadError}</span>}
              </div>
            </div>
          </Section>

          {(data?.history || []).length > 1 && (
            <Section title="Revision history">
              <ul className="text-sm text-ink-subtle space-y-1">
                {data.history.map((v: any) => (
                  <li key={v.id}>
                    <span className="text-ink font-medium">v{v.version}</span> — {v.title} · {fmt(v.createdAt)}
                    {v.supersededAt ? ` · superseded ${fmt(v.supersededAt)}` : " · in force"}
                    {" · "}
                    <a href={v.documentUrl} target="_blank" rel="noreferrer" className="text-accent-ink underline">
                      PDF
                    </a>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}
    </PageTransition>
  )
}
