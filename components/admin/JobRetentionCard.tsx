"use client"
import { useState } from "react"
import {
  RETENTION_REMINDER_DAYS,
  formatMoney,
  retentionFor,
  londonToday,
  type RetentionState,
} from "@/lib/retention"

/**
 * Retention on one job, on the job itself.
 *
 * This is where the numbers get entered, because this is where somebody is
 * already standing when they learn them: the contract value and the retention
 * percentage come off the order, and the practical completion date arrives as a
 * certificate months later. Sending an admin to a separate Money screen to type
 * a date they are holding in their hand is how the field stays empty, and an
 * empty field means no claim date, which means no reminder and no money.
 *
 * The figures shown here are computed by the same lib/retention.ts the Money
 * list and the letter use. Nothing is recomputed locally.
 */

type Props = {
  job: any
  /** Called after a successful save so the parent can refresh its job rows. */
  onSaved?: () => void
}

const STATE_NOTE: Record<RetentionState, string> = {
  none: "",
  not_started: "No practical completion date yet, so there is no claim date.",
  held: "",
  due_soon: `Showing on Today, ${RETENTION_REMINDER_DAYS} days ahead of the claim date.`,
  claimable: "Due now. The claim letter is one click away on the Retention tab.",
  released: "Released. This job is off the outstanding list.",
}

export default function JobRetentionCard({ job, onSaved }: Props) {
  const [contractValue, setContractValue] = useState(
    job.contract_value != null ? String(job.contract_value) : "",
  )
  const [percent, setPercent] = useState(
    job.retention_percent != null ? String(Number(job.retention_percent)) : "",
  )
  const [pcDate, setPcDate] = useState(job.practical_completion_date || "")
  const [months, setMonths] = useState(
    job.defects_period_months != null ? String(job.defects_period_months) : "",
  )
  const [releasedAt, setReleasedAt] = useState<string | null>(job.retention_released_at || null)

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Computed from what is currently in the inputs, not from what was last
  // saved, so the held figure and the claim date move as the terms are typed.
  // Somebody entering 5% on a 48,000 contract should see 2,400 before they
  // commit to it.
  const preview = retentionFor(
    {
      contractValue: contractValue === "" ? null : Number(contractValue),
      retentionPercent: percent === "" ? null : Number(percent),
      practicalCompletionDate: pcDate || null,
      defectsPeriodMonths: months === "" ? null : months,
      retentionReleasedAt: releasedAt,
    },
    londonToday(),
  )

  async function patch(payload: Record<string, any>) {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch("/api/admin/retention", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, ...payload }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        // 402 is the Suite gate. Said plainly rather than as a status code.
        setError(
          res.status === 402
            ? "Retention tracking is on the Suite plan."
            : body.error || `Could not save (${res.status})`,
        )
        return
      }
      if (body.job) setReleasedAt(body.job.retentionReleasedAt || null)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
      onSaved?.()
    } catch (e: any) {
      setError(e?.message || "Could not save")
    } finally {
      setSaving(false)
    }
  }

  const inp =
    "w-full rounded-md border border-line-strong bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-subtle transition-colors duration-fast ease-out focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-ink/20"
  const label = "block text-xs font-medium text-ink mb-1"

  return (
    <div className="mt-4 rounded-lg border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h4 className="text-sm font-bold text-ink">Retention</h4>
          <p className="text-xs text-ink-subtle mt-0.5">
            What the client holds back, and when it can be claimed.
          </p>
        </div>
        {preview.state !== "none" && (
          <div className="text-right shrink-0">
            <p className="text-xs uppercase tracking-wide text-ink-subtle">Held</p>
            <p className="num text-lg font-bold text-ink">{formatMoney(preview.amountHeld)}</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 mt-4">
        <div>
          <label className={label}>Contract value (£)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={contractValue}
            onChange={e => setContractValue(e.target.value)}
            placeholder="48000"
            className={inp}
          />
        </div>
        <div>
          <label className={label}>Retention (%)</label>
          <input
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={percent}
            onChange={e => setPercent(e.target.value)}
            placeholder="5"
            className={inp}
          />
        </div>
        <div>
          <label className={label}>Practical completion</label>
          <input
            type="date"
            value={pcDate}
            onChange={e => setPcDate(e.target.value)}
            className={inp}
          />
        </div>
        <div>
          <label className={label}>Defects period (months)</label>
          <input
            type="number"
            min="0"
            max="120"
            step="1"
            value={months}
            onChange={e => setMonths(e.target.value)}
            placeholder="12"
            className={inp}
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <p className="text-xs text-ink-subtle">
          Claim due:{" "}
          <span className="text-ink font-medium">
            {preview.claimDueDate ? longDate(preview.claimDueDate) : "not set"}
          </span>
        </p>
        {preview.daysUntilClaim !== null && preview.state !== "released" && (
          <p className="text-xs text-ink-subtle">{countdown(preview.daysUntilClaim)}</p>
        )}
      </div>

      {STATE_NOTE[preview.state] && (
        <p
          className={
            "text-xs mt-2 " +
            (preview.state === "claimable"
              ? "text-danger"
              : preview.state === "due_soon"
                ? "text-warning"
                : "text-ink-subtle")
          }
        >
          {STATE_NOTE[preview.state]}
        </p>
      )}

      {error && <p className="text-sm text-danger mt-3">{error}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() =>
            patch({
              contractValue: contractValue === "" ? null : Number(contractValue),
              retentionPercent: percent === "" ? null : Number(percent),
              practicalCompletionDate: pcDate || null,
              defectsPeriodMonths: months === "" ? null : Number(months),
            })
          }
          disabled={saving}
          className="bg-surface-hover hover:bg-line text-ink font-bold rounded-md px-4 py-2 text-sm transition-colors disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save retention"}
        </button>

        {releasedAt ? (
          <button
            type="button"
            onClick={() => patch({ action: "unrelease" })}
            disabled={saving}
            className="text-xs text-ink-subtle underline hover:text-ink"
          >
            Released {longDate(releasedAt)} — undo
          </button>
        ) : (
          preview.state !== "none" && (
            <button
              type="button"
              onClick={() => patch({ action: "release" })}
              disabled={saving}
              className="text-xs text-ink-subtle underline hover:text-ink"
            >
              Mark released
            </button>
          )
        )}

        {saved && <span className="text-xs text-accent-ink">Saved</span>}
      </div>
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

function countdown(days: number): string {
  if (days === 0) return "Due today"
  if (days > 0) return `in ${days} ${days === 1 ? "day" : "days"}`
  const late = Math.abs(days)
  return `${late} ${late === 1 ? "day" : "days"} overdue`
}
