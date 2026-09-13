"use client"
import { useState, useEffect, useCallback } from "react"
import { PageTransition, PageHeader, Section } from "@/components/ui/Page"

/**
 * Toolbox talks.
 *
 * The screen is built around the question an admin actually has, which is not
 * "what briefings exist" but "who has not signed one". So the outstanding names
 * are the loudest thing on each card, and a fully signed talk collapses to a
 * single quiet line. A list where compliant and non-compliant look similar is a
 * list nobody reads.
 */

type Talk = {
  id: string
  jobId: string
  jobName: string | null
  title: string
  notes: string | null
  documentUrl: string | null
  deliveredAt: string
  deliveredBy: string | null
  locked: boolean
  signed: Array<{ userId: string; name: string; signedAt: string; hasLocation: boolean }>
  outstanding: Array<{ id: string; name: string }>
  crewSize: number
}

function fmt(ts: string | null) {
  if (!ts) return "—"
  return new Date(ts).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  })
}

export default function ToolboxTalksTab({ jobs = [] }: { jobs?: Array<{ id: string; name: string }> }) {
  const [talks, setTalks] = useState<Talk[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterJob, setFilterJob] = useState("")

  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState("")
  const [notes, setNotes] = useState("")
  const [jobId, setJobId] = useState("")
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const url = filterJob ? `/api/admin/toolbox-talks?jobId=${encodeURIComponent(filterJob)}` : "/api/admin/toolbox-talks"
      const res = await fetch(url)
      const body = await res.json()
      if (!res.ok) setError(body.error || `Could not load talks (${res.status})`)
      else setTalks(body.talks || [])
    } catch (e: any) {
      setError(e?.message || "Could not load talks")
    }
    setLoading(false)
  }, [filterJob])

  useEffect(() => { load() }, [load])

  async function create() {
    setSaving(true)
    setFormError(null)
    const res = await fetch("/api/admin/toolbox-talks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, notes: notes || null, jobId }),
    })
    const body = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) { setFormError(body.error || `Could not save (${res.status})`); return }
    setTitle(""); setNotes(""); setJobId(""); setShowForm(false)
    load()
  }

  const inp =
    "w-full rounded-md border border-line-strong bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-ink/20"

  const totalOutstanding = talks.reduce((n, t) => n + t.outstanding.length, 0)

  return (
    <PageTransition>
      <PageHeader
        title="Toolbox talks"
        description="Safety briefings and who signed for them. A name shown as not signed is assigned to that job and has no signature on record."
      />

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <select value={filterJob} onChange={e => setFilterJob(e.target.value)} className={inp + " max-w-xs"}>
          <option value="">All jobs</option>
          {jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
        </select>
        <button
          onClick={() => setShowForm(v => !v)}
          className="bg-accent hover:bg-accent-ink text-white font-bold rounded-md px-5 py-2 text-sm transition-colors"
        >
          {showForm ? "Cancel" : "New talk"}
        </button>
        {totalOutstanding > 0 && (
          <span className="text-sm font-medium text-danger">
            {totalOutstanding} signature{totalOutstanding === 1 ? "" : "s"} outstanding
          </span>
        )}
      </div>

      {showForm && (
        <Section title="New toolbox talk">
          <div className="space-y-4 max-w-xl">
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Job</label>
              <select value={jobId} onChange={e => setJobId(e.target.value)} className={inp}>
                <option value="">Choose a job…</option>
                {jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Title</label>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                maxLength={200}
                placeholder="Working at height — edge protection"
                className={inp}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Notes</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={5}
                maxLength={8000}
                placeholder="What was covered, and anything specific to this site."
                className={inp}
              />
              <p className="text-xs text-ink-subtle mt-1">
                Once someone signs, the title and notes are locked. A briefing that changes after
                it has been signed for is not evidence of what anyone was told — raise a new talk instead.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={create}
                disabled={saving || !title.trim() || !jobId}
                className="bg-accent hover:bg-accent-ink text-white font-bold rounded-md px-5 py-2 text-sm transition-colors disabled:opacity-50"
              >
                {saving ? "Saving…" : "Create talk"}
              </button>
              {formError && <span className="text-sm text-danger">{formError}</span>}
            </div>
          </div>
        </Section>
      )}

      {loading && <div className="text-center py-12 text-ink-subtle">Loading talks…</div>}
      {error && <div className="text-sm text-danger py-4">{error}</div>}

      {!loading && !error && talks.length === 0 && (
        <div className="text-center py-12 text-ink-subtle text-sm">
          No toolbox talks yet. Create one and it appears on the crew&rsquo;s phones to sign.
        </div>
      )}

      <div className="space-y-4">
        {talks.map(t => {
          const complete = t.outstanding.length === 0 && t.crewSize > 0
          return (
            <div
              key={t.id}
              className={
                "rounded-lg border p-4 " +
                (complete ? "border-line bg-surface" : "border-danger/40 bg-surface")
              }
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="font-semibold text-ink">{t.title}</h3>
                  <p className="text-xs text-ink-subtle mt-0.5">
                    {t.jobName} · delivered {fmt(t.deliveredAt)}
                    {t.deliveredBy ? ` by ${t.deliveredBy}` : ""}
                  </p>
                </div>
                <span
                  className={
                    "shrink-0 text-xs font-bold rounded-full px-2.5 py-1 " +
                    (complete ? "bg-accent/15 text-accent-ink" : "bg-danger/15 text-danger")
                  }
                >
                  {t.signed.length} of {t.signed.length + t.outstanding.length} signed
                </span>
              </div>

              {t.notes && <p className="text-sm text-ink-subtle mt-3 whitespace-pre-wrap">{t.notes}</p>}

              {t.outstanding.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs uppercase tracking-wide text-danger font-semibold mb-1">
                    Not signed
                  </p>
                  <ul className="text-sm text-ink space-y-0.5">
                    {t.outstanding.map(o => <li key={o.id}>{o.name}</li>)}
                  </ul>
                </div>
              )}

              {t.signed.length > 0 && (
                <details className="mt-3">
                  <summary className="text-xs text-ink-subtle cursor-pointer select-none">
                    Signed by {t.signed.length}
                  </summary>
                  <ul className="text-sm text-ink-subtle mt-1 space-y-0.5">
                    {t.signed.map(s => (
                      <li key={s.userId}>
                        {s.name} — {fmt(s.signedAt)}
                        {s.hasLocation ? " · location recorded" : ""}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {t.crewSize === 0 && (
                <p className="text-xs text-warning mt-3">
                  Nobody is assigned to this job, so there is nobody to sign. Assign the crew and they
                  will see it on their phones.
                </p>
              )}
            </div>
          )
        })}
      </div>
    </PageTransition>
  )
}
