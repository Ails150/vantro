"use client"
import { useState, useEffect } from "react"
import { PageTransition, PageHeader, Section } from "@/components/ui/Page"
import { GEOFENCE_RADIUS_OPTIONS } from "@/lib/geofence"

export default function SettingsTab({ isSuperadmin = false }: { isSuperadmin?: boolean }) {
  const [gracePeriod, setGracePeriod] = useState(60)
  const [geofenceRadius, setGeofenceRadius] = useState(150)
  const [defaultStart, setDefaultStart] = useState("")
  const [defaultSignOut, setDefaultSignOut] = useState("")
  const [backgroundGps, setBackgroundGps] = useState(true)
  const [sickAutoApprove, setSickAutoApprove] = useState(false)
  const [quietStart, setQuietStart] = useState("19:00")
  const [quietEnd, setQuietEnd] = useState("06:00")
  const [weekendPush, setWeekendPush] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/admin/settings")
      .then((r) => r.json())
      .then((data) => {
        const c = data.company || {}
        if (c.grace_period_minutes != null) setGracePeriod(c.grace_period_minutes)
        if (c.geofence_radius_metres != null)
          setGeofenceRadius(c.geofence_radius_metres)
        if (c.background_gps_enabled != null)
          setBackgroundGps(c.background_gps_enabled)
        if (c.sick_auto_approve != null) setSickAutoApprove(c.sick_auto_approve)
        if (c.default_start_time) setDefaultStart(String(c.default_start_time).slice(0, 5))
        if (c.default_sign_out_time) setDefaultSignOut(String(c.default_sign_out_time).slice(0, 5))
        if (c.notification_quiet_start) setQuietStart(String(c.notification_quiet_start).slice(0, 5))
        if (c.notification_quiet_end) setQuietEnd(String(c.notification_quiet_end).slice(0, 5))
        if (c.notification_weekend_push != null) setWeekendPush(c.notification_weekend_push)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  async function save() {
    setSaving(true)
    setSaved(false)
    setError(null)
    const res = await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grace_period_minutes: gracePeriod,
        geofence_radius_metres: geofenceRadius,
        background_gps_enabled: backgroundGps,
        sick_auto_approve: sickAutoApprove,
        default_start_time: defaultStart || null,
        default_sign_out_time: defaultSignOut || null,
        notification_quiet_start: quietStart,
        notification_quiet_end: quietEnd,
        notification_weekend_push: weekendPush,
      }),
    })
    setSaving(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error || `Save failed (${res.status})`)
      return
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  if (loading)
    return <div className="text-center py-12 text-ink-subtle">Loading settings...</div>

  const inp =
    "w-full rounded-md border border-line-strong bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-subtle transition-colors duration-fast ease-out focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-ink/20"

  return (
    <PageTransition className="max-w-xl">
      <PageHeader
        title="Settings"
        description="Working hours, overrides and time off live in the Scheduler tab."
      />
      <Section title="Site rules">
        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">
              Grace period (minutes)
            </label>
            <select
              value={gracePeriod}
              onChange={(e) => setGracePeriod(Number(e.target.value))}
              className={inp}
            >
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
              <option value={45}>45 minutes</option>
              <option value={60}>1 hour</option>
              <option value={90}>1.5 hours</option>
              <option value={120}>2 hours</option>
            </select>
            <p className="text-xs text-ink-subtle mt-1">
              After sign-out time + grace period, hours are calculated to the
              last on-site GPS location.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink mb-1">
              Geofence radius (metres)
            </label>
            <select
              value={geofenceRadius}
              onChange={(e) => setGeofenceRadius(Number(e.target.value))}
              className={inp}
            >
              {GEOFENCE_RADIUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <p className="text-xs text-ink-subtle mt-1">
              Installers must be within this distance of the job site to sign
              in and out.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                Default shift start
              </label>
              <input
                type="time"
                value={defaultStart}
                onChange={(e) => setDefaultStart(e.target.value)}
                className={inp}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                Default sign-out
              </label>
              <input
                type="time"
                value={defaultSignOut}
                onChange={(e) => setDefaultSignOut(e.target.value)}
                className={inp}
              />
            </div>
          </div>
          <p className="text-xs text-ink-subtle -mt-3">
            New jobs pre-fill with these times. You can override them per job.
          </p>

          <div className="flex items-start justify-between gap-4 pt-2 border-t border-line">
            <div className="flex-1">
              <label className="block text-sm font-medium text-ink">
                Background GPS tracking
              </label>
              <p className="text-xs text-ink-subtle mt-1">
                Log GPS breadcrumbs every 30 minutes while signed in, even when
                the app is in the background. Required for full compliance trail.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setBackgroundGps(!backgroundGps)}
              className={
                "relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors " +
                (backgroundGps ? "bg-accent" : "bg-surface-hover")
              }
              aria-pressed={backgroundGps}
              aria-label="Toggle background GPS tracking"
            >
              <span
                className={
                  "inline-block h-4 w-4 transform rounded-full bg-canvas shadow transition-transform " +
                  (backgroundGps ? "translate-x-6" : "translate-x-1")
                }
              />
            </button>
          </div>

          <div className="flex items-start justify-between gap-4 pt-2 border-t border-line">
            <div className="flex-1">
              <label className="block text-sm font-medium text-ink">
                Auto-approve sick leave
              </label>
              <p className="text-xs text-ink-subtle mt-1">
                When on, installers' same-day sick requests are approved
                immediately and admins can review later. When off, every
                request goes to the approval queue.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSickAutoApprove(!sickAutoApprove)}
              className={
                "relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors " +
                (sickAutoApprove ? "bg-accent" : "bg-surface-hover")
              }
              aria-pressed={sickAutoApprove}
              aria-label="Toggle auto-approve sick leave"
            >
              <span
                className={
                  "inline-block h-4 w-4 transform rounded-full bg-canvas shadow transition-transform " +
                  (sickAutoApprove ? "translate-x-6" : "translate-x-1")
                }
              />
            </button>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={save}
              disabled={saving}
              className="bg-accent hover:bg-accent-ink text-white font-bold rounded-md px-6 py-2.5 text-sm transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save settings"}
            </button>
            {saved && (
              <span className="text-sm text-accent-ink font-medium">
                Settings saved
              </span>
            )}
            {error && <span className="text-sm text-danger">{error}</span>}
          </div>
        </div>
      </Section>

      <Section title="Notification quiet hours">
        <div className="space-y-5">
          <p className="text-xs text-ink-subtle">
            Shift reminders and sign-out notices are held during these hours.
            The window may run past midnight. Auto sign-out still happens on
            time; only the push to the worker waits.
          </p>

          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-sm font-medium text-ink mb-1">Quiet from</label>
              <input type="time" value={quietStart} onChange={e => setQuietStart(e.target.value)} className={inp} />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-ink mb-1">Quiet until</label>
              <input type="time" value={quietEnd} onChange={e => setQuietEnd(e.target.value)} className={inp} />
            </div>
          </div>

          <div className="flex items-start justify-between gap-4 pt-2 border-t border-line">
            <div className="flex-1">
              <label className="block text-sm font-medium text-ink">
                Push on Saturdays and Sundays
              </label>
              <p className="text-xs text-ink-subtle mt-1">
                Off by default. A worker who is rostered for a weekend day still
                gets their notifications either way — this only covers weekend
                days nobody is scheduled on.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setWeekendPush(!weekendPush)}
              className={
                "relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors " +
                (weekendPush ? "bg-accent" : "bg-surface-hover")
              }
              aria-pressed={weekendPush}
              aria-label="Toggle weekend push notifications"
            >
              <span
                className={
                  "inline-block h-4 w-4 transform rounded-full bg-canvas shadow transition-transform " +
                  (weekendPush ? "translate-x-6" : "translate-x-1")
                }
              />
            </button>
          </div>

          <p className="text-xs text-ink-subtle">
            Saved with the button above.
          </p>
        </div>
      </Section>

      <WeeklyReportSection />

      {isSuperadmin && <DemoDataSection />}
    </PageTransition>
  )
}

/**
 * Send this week's report on demand.
 *
 * Every admin, every plan. The Friday email is the one piece of the product
 * that arrives when nobody is looking at the screen, which made it the one
 * piece nobody could check. This is the check.
 *
 * The Resend message id is shown rather than hidden in a log: when a customer
 * says the report never arrived, the id is what turns that into a question with
 * an answer -- delivered, bounced, or never sent at all.
 */
function WeeklyReportSection() {
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState<any>(null)
  const [failed, setFailed] = useState<string | null>(null)

  async function send() {
    setSending(true)
    setFailed(null)
    setSent(null)
    try {
      const res = await fetch("/api/admin/weekly-report", { method: "POST" })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) setFailed(body.error || `Send failed (${res.status})`)
      else setSent(body)
    } catch (e: any) {
      setFailed(e?.message || "Send failed")
    }
    setSending(false)
  }

  return (
    <Section title="Weekly report">
      <div className="space-y-4">
        <p className="text-xs text-ink-subtle">
          A one-page PDF of this week so far &mdash; hours, shifts, who worked
          &mdash; emailed to every active admin on this company. It sends
          automatically at 5pm on Friday; this sends the same email now, and does
          not replace Friday&rsquo;s.
        </p>

        <button
          onClick={send}
          disabled={sending}
          className="bg-surface-hover hover:bg-line text-ink font-bold rounded-md px-6 py-2.5 text-sm transition-colors disabled:opacity-50"
        >
          {sending ? "Sending..." : "Send this week's report now"}
        </button>

        {failed && <p className="text-sm text-danger">{failed}</p>}

        {sent && (
          <div className="rounded-md border border-line-strong bg-surface p-4 space-y-2 text-sm">
            <p className="font-medium text-ink">
              Sent to {sent.recipients?.length || 0}{" "}
              {sent.recipients?.length === 1 ? "admin" : "admins"}.
            </p>
            <p className="text-xs text-ink-subtle">
              {sent.recipients?.join(", ")}
            </p>
            <p className="text-xs text-ink-subtle">
              Week of {sent.weekStart} &middot; {Number(sent.totalHours || 0).toFixed(1)}h across{" "}
              {sent.shiftCount || 0} shifts
              {sent.shiftCount === 0 && " (nothing recorded yet this week)"}
            </p>
            <div>
              <p className="text-xs uppercase tracking-wide text-ink-subtle mb-1">
                Resend message id
              </p>
              <p className="text-ink font-mono text-xs break-all">
                {sent.messageId || "not returned by the provider"}
              </p>
            </div>
          </div>
        )}
      </div>
    </Section>
  )
}

/**
 * Superadmin only. Builds the Northbridge Glazing demo tenant.
 *
 * Deliberately wordy about what it does before it does it: this creates and
 * destroys an entire company, and the button is two clicks from the settings a
 * normal admin uses every week. The confirm step names the company so nobody
 * can mistake it for a reset of their own data.
 */
function DemoDataSection() {
  const [running, setRunning] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [failed, setFailed] = useState<string | null>(null)

  async function run() {
    setRunning(true)
    setFailed(null)
    setResult(null)
    try {
      const res = await fetch("/api/admin/seed-demo", { method: "POST" })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) setFailed(body.error || `Seed failed (${res.status})`)
      else setResult(body)
    } catch (e: any) {
      setFailed(e?.message || "Seed failed")
    }
    setRunning(false)
    setConfirming(false)
  }

  return (
    <Section title="Demo data">
      <div className="space-y-4">
        <p className="text-xs text-ink-subtle">
          Builds <strong className="text-ink">Northbridge Glazing Ltd</strong>: eight workers,
          three sites in Cambridge, Ely and Newmarket, six weeks of sign-ins,
          diary entries, a defect raised and closed, and a signed Compliance
          Audit Pack. Running it again rebuilds that company from scratch. It
          touches no other company&rsquo;s data.
        </p>

        {!confirming && (
          <button
            onClick={() => setConfirming(true)}
            disabled={running}
            className="bg-surface-hover hover:bg-line text-ink font-bold rounded-md px-6 py-2.5 text-sm transition-colors disabled:opacity-50"
          >
            {running ? "Loading demo..." : "Load demo"}
          </button>
        )}

        {confirming && (
          <div className="rounded-md border border-line-strong bg-surface p-4 space-y-3">
            <p className="text-sm text-ink">
              This deletes and rebuilds every row belonging to Northbridge
              Glazing Ltd, including its logins. Nothing outside that company is
              touched. Continue?
            </p>
            <div className="flex gap-3">
              <button
                onClick={run}
                disabled={running}
                className="bg-accent hover:bg-accent-ink text-white font-bold rounded-md px-5 py-2 text-sm transition-colors disabled:opacity-50"
              >
                {running ? "Building..." : "Yes, rebuild the demo"}
              </button>
              <button
                onClick={() => setConfirming(false)}
                disabled={running}
                className="text-ink-subtle hover:text-ink px-3 py-2 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {failed && <p className="text-sm text-danger">{failed}</p>}

        {result && (
          <div className="rounded-md border border-line-strong bg-surface p-4 space-y-3 text-sm">
            <p className="font-medium text-ink">{result.companyName} is ready.</p>

            <div>
              <p className="text-xs uppercase tracking-wide text-ink-subtle mb-1">Admin login</p>
              <p className="text-ink font-mono text-xs">{result.admin?.email}</p>
              <p className="text-ink font-mono text-xs">{result.admin?.password}</p>
            </div>

            <div>
              <p className="text-xs uppercase tracking-wide text-ink-subtle mb-1">Worker PINs</p>
              <ul className="text-xs text-ink-subtle space-y-0.5">
                {(result.workers || []).map((w: any) => (
                  <li key={w.email} className="font-mono">
                    {w.pin} &nbsp;{w.name} &nbsp;<span className="opacity-60">{w.email}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="text-xs uppercase tracking-wide text-ink-subtle mb-1">Built</p>
              <ul className="text-xs text-ink-subtle">
                {Object.entries(result.counts || {}).map(([k, v]) => (
                  <li key={k}>{k.replace(/_/g, " ")}: {String(v)}</li>
                ))}
              </ul>
            </div>

            {result.auditPack?.reference && (
              <div>
                <p className="text-xs uppercase tracking-wide text-ink-subtle mb-1">Audit pack</p>
                <p className="text-xs text-ink-subtle font-mono">{result.auditPack.reference}</p>
                <p className="text-xs text-ink-subtle">
                  {result.auditPack.signed ? "Signed" : "UNSIGNED"} &middot;{" "}
                  {result.auditPack.evidenceCount} pieces of evidence
                </p>
              </div>
            )}

            {(result.warnings || []).length > 0 && (
              <div>
                <p className="text-xs uppercase tracking-wide text-warning mb-1">Warnings</p>
                <ul className="text-xs text-ink-subtle list-disc pl-4 space-y-0.5">
                  {result.warnings.map((w: string) => <li key={w}>{w}</li>)}
                </ul>
              </div>
            )}

            {(result.unsupported || []).length > 0 && (
              <div>
                <p className="text-xs uppercase tracking-wide text-ink-subtle mb-1">Not seeded</p>
                <ul className="text-xs text-ink-subtle list-disc pl-4 space-y-0.5">
                  {result.unsupported.map((u: string) => <li key={u}>{u}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </Section>
  )
}
