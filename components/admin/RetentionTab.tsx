"use client"
import { useState, useEffect, useCallback } from "react"
import { PageTransition, PageHeader, Section } from "@/components/ui/Page"
import { formatMoney, type RetentionState } from "@/lib/retention"

/**
 * Retention: what clients are still holding, and when each piece can be asked
 * for.
 *
 * Ordered by claim date, soonest first, because the list is a queue of work
 * rather than a report. The two states that need doing something about --
 * claimable and due soon -- are coloured; held and not-started are quiet.
 *
 * Released jobs stay in the list, greyed, rather than disappearing. A company
 * wants to see that the money came back, and a row that vanishes on the click
 * of a button gives no confirmation that anything happened.
 */

type RetentionJob = {
  id: string
  name: string
  contractor: string | null
  status: string | null
  contractValue: number | null
  retentionPercent: number | null
  practicalCompletionDate: string | null
  defectsPeriodMonths: number | null
  retentionReleasedAt: string | null
  state: RetentionState
  amountHeld: number
  claimDueDate: string | null
  daysUntilClaim: number | null
}

type Totals = {
  held: number
  jobCount: number
  dueSoon: number
  claimable: number
  released: number
}

const STATE_LABEL: Record<RetentionState, string> = {
  none: "No retention",
  not_started: "Awaiting completion",
  held: "Held",
  due_soon: "Due soon",
  claimable: "Claim now",
  released: "Released",
}

export default function RetentionTab() {
  const [jobs, setJobs] = useState<RetentionJob[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [showReleased, setShowReleased] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch("/api/admin/retention")
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error || `Could not load retention (${res.status})`)
        return
      }
      setJobs(body.jobs || [])
      setTotals(body.totals || null)
    } catch (e: any) {
      setError(e?.message || "Could not load retention")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function release(job: RetentionJob, action: "release" | "unrelease") {
    setBusy(job.id)
    setActionError(null)
    try {
      const res = await fetch("/api/admin/retention", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, action }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) setActionError(body.error || `Could not update (${res.status})`)
      else await load()
    } catch (e: any) {
      setActionError(e?.message || "Could not update")
    }
    setBusy(null)
  }

  /**
   * The letter opens in a new tab rather than downloading.
   *
   * It is a document going to a client under the company's name, and it should
   * be read before it is sent. A silent download into a folder is how one goes
   * out with last year's figure on it.
   */
  async function letter(job: RetentionJob) {
    setBusy(job.id)
    setActionError(null)
    try {
      const res = await fetch("/api/admin/retention/letter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setActionError(body.error || `Could not generate the letter (${res.status})`)
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      window.open(url, "_blank", "noopener")
      // Revoked on a delay: revoking immediately races the new tab reading it.
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (e: any) {
      setActionError(e?.message || "Could not generate the letter")
    }
    setBusy(null)
  }

  const visible = showReleased ? jobs : jobs.filter(j => j.state !== "released")

  return (
    <PageTransition>
      <PageHeader
        title="Retention"
        description="What clients are holding back, and when each piece falls due. Claims appear on Today 30 days before the date."
      />

      {totals && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mb-6">
          <Figure label="Held across jobs" value={formatMoney(totals.held)} />
          <Figure label="Jobs" value={String(totals.jobCount)} />
          <Figure
            label="Claimable now"
            value={String(totals.claimable)}
            tone={totals.claimable > 0 ? "danger" : undefined}
          />
          <Figure
            label="Due within 30 days"
            value={String(totals.dueSoon)}
            tone={totals.dueSoon > 0 ? "warning" : undefined}
          />
        </div>
      )}

      <div className="flex items-center gap-4 mb-5">
        <button
          onClick={() => setShowReleased(v => !v)}
          className="text-sm text-ink-subtle underline hover:text-ink"
        >
          {showReleased ? "Hide released" : "Include released"}
        </button>
      </div>

      {loading && <div className="text-center py-12 text-ink-subtle">Loading…</div>}
      {error && <div className="text-sm text-danger py-4">{error}</div>}
      {actionError && <div className="text-sm text-danger py-2">{actionError}</div>}

      {!loading && !error && visible.length === 0 && (
        <div className="text-center py-12 text-ink-subtle text-sm">
          No retention recorded yet. Set a contract value, a retention percentage
          and a practical completion date on a job and it appears here.
        </div>
      )}

      <div className="space-y-4">
        {visible.map(job => (
          <RetentionRow
            key={job.id}
            job={job}
            busy={busy === job.id}
            onLetter={() => letter(job)}
            onRelease={() => release(job, "release")}
            onUnrelease={() => release(job, "unrelease")}
          />
        ))}
      </div>
    </PageTransition>
  )
}

function RetentionRow({
  job, busy, onLetter, onRelease, onUnrelease,
}: {
  job: RetentionJob
  busy: boolean
  onLetter: () => void
  onRelease: () => void
  onUnrelease: () => void
}) {
  const released = job.state === "released"
  return (
    <div
      className={
        "rounded-lg border p-4 " +
        (released
          ? "border-line bg-surface opacity-70"
          : job.state === "claimable"
            ? "border-danger/60 bg-surface"
            : job.state === "due_soon"
              ? "border-warning/50 bg-surface"
              : "border-line bg-surface")
      }
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-semibold text-ink truncate">{job.name}</h3>
          <p className="text-xs text-ink-subtle mt-0.5">
            {job.contractor || "No client recorded"}
            {job.contractValue != null && ` · contract ${formatMoney(job.contractValue)}`}
            {job.retentionPercent != null && ` · ${Number(job.retentionPercent)}% retention`}
          </p>
        </div>
        <StateBadge state={job.state} />
      </div>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-8 gap-y-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-ink-subtle">Held</p>
          <p className="num text-xl font-bold text-ink">{formatMoney(job.amountHeld)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-ink-subtle">Claim due</p>
          <p className="text-sm text-ink">
            {job.claimDueDate ? longDate(job.claimDueDate) : "Not set"}
          </p>
          {job.claimDueDate && !released && (
            <p className="text-xs text-ink-subtle">{countdown(job.daysUntilClaim)}</p>
          )}
        </div>
        {job.practicalCompletionDate && (
          <div>
            <p className="text-xs uppercase tracking-wide text-ink-subtle">
              Practical completion
            </p>
            <p className="text-sm text-ink">{longDate(job.practicalCompletionDate)}</p>
          </div>
        )}
      </div>

      {job.state === "not_started" && (
        <p className="text-xs text-ink-subtle mt-3">
          No practical completion date yet, so there is no claim date. The money
          still counts towards the total above.
        </p>
      )}

      <div className="mt-4 pt-3 border-t border-line flex flex-wrap gap-3">
        {!released && (
          <>
            <button
              onClick={onLetter}
              disabled={busy}
              className="bg-accent hover:bg-accent-ink text-white font-bold rounded-md px-4 py-2 text-sm transition-colors disabled:opacity-50"
            >
              {busy ? "Working…" : "Claim letter"}
            </button>
            <button
              onClick={onRelease}
              disabled={busy}
              className="bg-surface-hover hover:bg-line text-ink font-medium rounded-md px-4 py-2 text-sm transition-colors disabled:opacity-50"
            >
              Mark released
            </button>
          </>
        )}
        {released && (
          <>
            <p className="text-xs text-ink-subtle self-center">
              Released {job.retentionReleasedAt ? longDate(job.retentionReleasedAt) : ""}
            </p>
            <button
              onClick={onUnrelease}
              disabled={busy}
              className="text-xs text-ink-subtle underline hover:text-ink"
            >
              Undo
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function StateBadge({ state }: { state: RetentionState }) {
  const tone =
    state === "claimable"
      ? "bg-danger/15 text-danger"
      : state === "due_soon"
        ? "bg-warning/20 text-warning"
        : state === "released"
          ? "bg-surface-hover text-ink-subtle"
          : "bg-surface-hover text-ink-subtle"
  return (
    <span className={"shrink-0 text-xs font-bold rounded-full px-2.5 py-1 " + tone}>
      {STATE_LABEL[state]}
    </span>
  )
}

function Figure({
  label, value, tone,
}: {
  label: string
  value: string
  tone?: "danger" | "warning"
}) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="text-xs uppercase tracking-wide text-ink-subtle">{label}</p>
      <p
        className={
          "num text-2xl font-bold mt-1 " +
          (tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-ink")
        }
      >
        {value}
      </p>
    </div>
  )
}

function longDate(value: string): string {
  const parsed = Date.parse(`${value.slice(0, 10)}T12:00:00Z`)
  if (!Number.isFinite(parsed)) return value
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  }).format(new Date(parsed))
}

/** "in 12 days" / "3 days ago". Overdue is stated in days, not softened. */
function countdown(days: number | null): string {
  if (days === null) return ""
  if (days === 0) return "Due today"
  if (days > 0) return `in ${days} ${days === 1 ? "day" : "days"}`
  const late = Math.abs(days)
  return `${late} ${late === 1 ? "day" : "days"} overdue`
}
