"use client"

import * as React from "react"
import { motion } from "framer-motion"
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  ArrowDownRight,
  ClipboardCheck,
  Circle,
  Share2,
  UserPlus,
  Wrench,
} from "lucide-react"
import { isFieldOrSupervisor } from "@/lib/roles"
import { historyDays, type Plan } from "@/lib/plan"
import { PageTransition, PageHeader } from "@/components/ui/Page"
import { Card, StatTile, IconCircle, Avatar } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Table, TBody, TR, TD } from "@/components/ui/Table"
import { listVariants, itemVariants } from "@/components/ui/motion"

import { formatIn, formatTime } from "@/lib/format-time"
// Overview tab. Look and feel only -- every figure still comes from the
// `overviewData` memo computed by the parent, nothing here fetches, and no
// query was touched.
//
// The model is Linear and Vercel, not a magazine: one face (Geist), white
// cards on an off-white ground, colour confined to icons and the one accent
// bar. There is no display serif and no hero numeral.

type Props = {
  overviewData: any
  teamMembers: any[]
  pendingQA: any[]
  /** The viewer. Their own row is never flagged late -- see LateNote. */
  currentUserId?: string
  /** Drives the one upgrade line on this page. */
  plan?: Plan
  /**
   * The shared clock, from AdminDashboard. Every elapsed time on this page is
   * measured from it so the first render matches the server HTML.
   */
  nowMs: number
  onNavigate: (tab: string) => void
}

/** Action-queue icons. Colour lands here and nowhere else on the row. */
const actionIcon: Record<string, any> = {
  qa: ClipboardCheck,
  blockers: AlertTriangle,
  staffing: UserPlus,
  trades: Wrench,
}

const severityTone: Record<string, "danger" | "warn" | "neutral"> = {
  high: "danger",
  medium: "warn",
  low: "neutral",
}

/** Inline "go to tab" affordance. Ghost-button semantics without the chrome. */
function GoTo({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group inline-flex items-center gap-1 text-xs font-medium text-accent-ink transition-colors duration-fast ease-out hover:text-ink"
    >
      {label}
      <ArrowRight
        size={12}
        className="transition-transform duration-fast ease-out group-hover:translate-x-0.5"
      />
    </button>
  )
}

/**
 * A row inside a list card. Padding matches the card's 16px gutter so the
 * hairline between rows runs the full width of the card.
 */
function Row({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <motion.li
      variants={itemVariants}
      onClick={onClick}
      className={`flex items-center justify-between gap-4 border-b border-line px-4 py-3 last:border-0 transition-colors duration-fast ease-out hover:bg-surface-hover ${
        onClick ? "cursor-pointer" : ""
      }`}
    >
      {children}
    </motion.li>
  )
}

/** Week-on-week delta. Direction only -- no colour, it is not a status. */
function Delta({ now, prev, unit = "" }: { now: number; prev: number; unit?: string }) {
  if (prev === 0 && now === 0) return <span>Same as last week</span>
  const diff = now - prev
  if (diff === 0) return <span>Same as last week</span>
  const Icon = diff > 0 ? ArrowUpRight : ArrowDownRight
  return (
    <span className="inline-flex items-center gap-1">
      <Icon size={12} className="shrink-0" />
      <span className="num">
        {Math.abs(diff)}
        {unit}
      </span>
      <span>vs last week</span>
    </span>
  )
}

/**
 * Lateness. Muted by default; amber only past half an hour, because a few
 * minutes after the shift time is noise, not a problem. Never amber for the
 * viewer's own account -- an admin sitting in the office is not "late".
 */
function LateNote({ minsLate, isSelf }: { minsLate: number; isSelf: boolean }) {
  if (minsLate <= 0) return <span className="text-xs text-ink-subtle">Due now</span>
  const label = minsLate >= 60 ? `${Math.floor(minsLate / 60)}h ${minsLate % 60}m late` : `${minsLate}m late`
  const amber = minsLate > 30 && !isSelf
  return (
    <span className={`num text-xs ${amber ? "font-medium text-warn" : "text-ink-muted"}`}>{label}</span>
  )
}

/** "08:00" -> "08:00". Kept as a function so a bad value degrades to a dash. */
function shiftTime(value?: string) {
  if (!value) return "—"
  const [h, m] = String(value).split(":")
  if (h === undefined || m === undefined) return "—"
  return `${h.padStart(2, "0")}:${m.slice(0, 2).padStart(2, "0")}`
}

export default function DashboardTab({
  overviewData,
  teamMembers,
  pendingQA,
  currentUserId,
  plan = "free",
  nowMs,
  onNavigate,
}: Props) {
  const peopleThisWeek = React.useMemo(() => {
    return (teamMembers || [])
      .filter((m: any) => isFieldOrSupervisor(m.role) && m.is_active !== false)
      .map((m: any) => ({ name: m.name, hours: overviewData.installerHoursThisWeek[m.id] || 0 }))
      .sort((a: any, b: any) => b.hours - a.hours)
  }, [teamMembers, overviewData.installerHoursThisWeek])

  // Age of the oldest queued QA, for the first tile's foot line.
  const oldestQA = React.useMemo(() => {
    if (!pendingQA || pendingQA.length === 0) return null
    const oldest = pendingQA.reduce((acc: any, q: any) =>
      !acc || new Date(q.created_at) < new Date(acc.created_at) ? q : acc, null)
    if (!oldest?.created_at) return null
    const hours = Math.floor((nowMs - new Date(oldest.created_at).getTime()) / 3600000)
    return hours >= 24 ? `${Math.floor(hours / 24)}d` : `${hours}h`
  }, [pendingQA, nowMs])

  const tiles = [
    {
      label: "QA approvals",
      value: pendingQA.length,
      tab: "approvals",
      foot: oldestQA ? `Oldest ${oldestQA} waiting` : "Nothing waiting",
    },
    {
      label: "Open alerts",
      value: overviewData.unresolvedAlertCount,
      tab: "alerts",
      foot:
        overviewData.oldAlertCount > 0
          ? `${overviewData.oldAlertCount} over 7 days`
          : "All under 7 days",
    },
    {
      label: "Alerts over 7d",
      value: overviewData.oldAlertCount,
      tab: "alerts",
      foot: `Of ${overviewData.unresolvedAlertCount} open`,
    },
    {
      label: "Jobs completed",
      value: overviewData.jobsCompletedThisWeek,
      tab: "jobs",
      foot: (
        <Delta
          now={overviewData.jobsCompletedThisWeek}
          prev={overviewData.jobsCompletedLastWeek}
        />
      ),
    },
  ]

  const maxWeekHours = Math.max(...peopleThisWeek.map((p: any) => p.hours), 40)
  const barMax = Math.max(...overviewData.sparkline, 1)
  const actionItems = overviewData.actionItems as any[]
  const visibleActions = actionItems.slice(0, 4)
  const notSignedIn = overviewData.attendanceWithTime as any[]

  return (
    <PageTransition>
      <PageHeader
        title="Overview"
        description="What needs you today, and where the work stands."
        actions={<ShareInviteButton />}
      />

      {/* The one upgrade line on this page, and only on Free.
          It leads with what Free already does -- sign in is geofenced, so the
          hours on this board are verified -- because an upsell that implies the
          numbers above cannot be trusted is an argument against the product. */}
      {plan === "free" && <FreePlanLine onNavigate={onNavigate} />}

      {/* Four tiles, 12px gutters. Label, figure, one line of context. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((t) => (
          <StatTile
            key={t.label}
            label={t.label}
            value={t.value}
            foot={t.foot}
            onClick={() => onNavigate(t.tab)}
          />
        ))}
      </div>

      {/* Action queue. Four rows at most -- past that it is a list, not a queue. */}
      <Card
        title="Needs you today"
        className="mt-4"
        padded={false}
        actions={
          actionItems.length > 0 ? (
            <GoTo label="View all" onClick={() => onNavigate("alerts")} />
          ) : undefined
        }
      >
        {actionItems.length === 0 ? (
          <Quiet line="Nothing needs your attention right now." />
        ) : (
          <motion.ul initial="hidden" animate="visible" variants={listVariants}>
            {visibleActions.map((item: any) => {
              const Icon = actionIcon[item.key] || Circle
              return (
                <Row key={item.key} onClick={() => onNavigate(item.tab)}>
                  <div className="flex min-w-0 items-center gap-3">
                    <IconCircle tone={severityTone[item.severity] || "neutral"}>
                      <Icon size={15} />
                    </IconCircle>
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ink">{item.label}</p>
                      {item.sub && (
                        <p className="mt-0.5 truncate text-xs text-ink-muted">{item.sub}</p>
                      )}
                    </div>
                  </div>
                  <ArrowRight size={14} className="shrink-0 text-ink-subtle" />
                </Row>
              )
            })}
          </motion.ul>
        )}
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* On site now */}
        <Card
          title="On site now"
          padded={false}
          actions={<GoTo label="Map" onClick={() => onNavigate("map")} />}
        >
          {overviewData.onSiteNow.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 pb-8 pt-4 text-center">
              <p className="max-w-[34ch] text-sm leading-relaxed text-ink-muted">
                No one on site yet. Workers appear here the moment they sign in.
              </p>
              <ShareInviteButton />
            </div>
          ) : (
            <motion.ul
              initial="hidden"
              animate="visible"
              variants={listVariants}
              className="max-h-80 overflow-y-auto"
            >
              {overviewData.onSiteNow.map((p: any, idx: number) => {
                const mins = Math.max(
                  0,
                  Math.floor((nowMs - new Date(p.signedInAt).getTime()) / 60000)
                )
                const h = Math.floor(mins / 60)
                const m = mins % 60
                return (
                  <Row key={idx}>
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar initials={p.initials} tone="accent" />
                      <div className="min-w-0">
                        <p className="truncate text-sm text-ink">{p.name}</p>
                        <p className="truncate text-xs text-ink-muted" title={p.jobName}>
                          {p.jobName}
                        </p>
                      </div>
                    </div>
                    <span className="num shrink-0 text-xs text-ink-muted">
                      {(h > 0 ? h + "h " : "") + m + "m"}
                    </span>
                  </Row>
                )
              })}
            </motion.ul>
          )}
        </Card>

        {/* Hours today: three figures, then the week under them. */}
        <Card title="Hours today">
          <div className="grid grid-cols-3 gap-3">
            <Figure label="Live" value={overviewData.liveHours + "h"} />
            <Figure label="Signed out" value={overviewData.todayHours + "h"} />
            <Figure label="This week" value={overviewData.hoursThisWeek + "h"} />
          </div>

          <div className="mt-6 flex h-24 items-end gap-1.5">
            {overviewData.sparkline.map((v: number, idx: number) => {
              const isToday = idx === overviewData.sparkline.length - 1
              return (
                <div
                  key={idx}
                  className="flex h-full flex-1 flex-col justify-end"
                  title={`${overviewData.sparklineLabels[idx]}: ${v}h`}
                >
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: Math.max(2, (v / barMax) * 100) + "%" }}
                    transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1], delay: idx * 0.02 }}
                    className={`w-full rounded-t-[3px] bg-accent ${isToday ? "" : "opacity-40"}`}
                  />
                </div>
              )
            })}
          </div>
          <div className="mt-2 flex gap-1.5 border-t border-line pt-2">
            {overviewData.sparklineLabels.map((lbl: string, idx: number) => (
              <div
                key={idx}
                className={`flex-1 text-center text-[11px] ${
                  idx === overviewData.sparklineLabels.length - 1
                    ? "font-medium text-ink"
                    : "text-ink-subtle"
                }`}
              >
                {lbl}
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Not signed in yet */}
      {notSignedIn.length > 0 && (
        <Card
          title="Not signed in yet"
          className="mt-4"
          padded={false}
          actions={<span className="num text-xs text-ink-muted">{notSignedIn.length}</span>}
        >
          <p className="-mt-1 px-4 pb-3 text-xs text-ink-muted">
            Assigned to active jobs but no sign-in recorded today
          </p>
          <Table>
            <TBody>
              {notSignedIn.slice(0, 9).map((g: any, idx: number) => (
                <TR key={idx}>
                  <TD>
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar initials={g.initials || "?"} />
                      <span className="truncate text-sm text-ink" title={g.installerName}>
                        {g.installerName}
                      </span>
                    </div>
                  </TD>
                  <TD className="hidden sm:table-cell">
                    <span className="truncate text-sm text-ink-muted" title={g.jobName}>
                      {g.jobName}
                    </span>
                  </TD>
                  <TD numeric className="text-xs text-ink-muted">
                    Due {shiftTime(g.expectedStart)}
                  </TD>
                  <TD numeric>
                    <LateNote minsLate={g.minsLate} isSelf={g.userId === currentUserId} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {notSignedIn.length > 9 && (
            <p className="border-t border-line px-4 py-2.5 text-xs text-ink-subtle">
              + {notSignedIn.length - 9} more
            </p>
          )}
        </Card>
      )}

      {/* Jobs at a glance */}
      <Card
        title="Jobs at a glance"
        className="mt-4"
        padded={false}
        actions={<GoTo label="All jobs" onClick={() => onNavigate("jobs")} />}
      >
        {overviewData.jobRAG.length === 0 ? (
          <Quiet line="No active jobs yet." actionLabel="Create a job" onAction={() => onNavigate("jobs")} />
        ) : (
          <motion.ul initial="hidden" animate="visible" variants={listVariants}>
            {overviewData.jobRAG.map((j: any) => {
              const parts: string[] = []
              if (j.openBlockers > 0)
                parts.push(j.openBlockers === 1 ? "1 blocker" : j.openBlockers + " blockers")
              if (j.assigned > 0 && j.onSite === 0) parts.push("nobody on site")
              if (j.pendingQA > 0)
                parts.push(j.pendingQA === 1 ? "1 QA waiting" : j.pendingQA + " QA waiting")
              if (j.daysSinceActivity >= 999) parts.push("no activity yet")
              else if (j.daysSinceActivity > 3) parts.push("quiet " + j.daysSinceActivity + "d")
              const dot = j.rag === "red" ? "bg-danger" : j.rag === "amber" ? "bg-warn" : "bg-accent"
              return (
                <Row key={j.jobId} onClick={() => onNavigate("jobs")}>
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ink" title={j.jobName}>
                        {j.jobName}
                      </p>
                      <p className="truncate text-xs text-ink-muted">
                        {parts.length > 0 ? parts.join(" · ") : "On track"}
                      </p>
                    </div>
                  </div>
                  <span className="num shrink-0 text-sm text-ink-muted">
                    {j.onSite}/{j.assigned}
                  </span>
                </Row>
              )
            })}
          </motion.ul>
        )}
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* People this week */}
        <Card
          title="People this week"
          actions={<GoTo label="Payroll" onClick={() => onNavigate("payroll")} />}
        >
          {peopleThisWeek.length === 0 ? (
            <Quiet line="No team members yet." actionLabel="Add someone" onAction={() => onNavigate("team")} />
          ) : (
            <motion.ul
              initial="hidden"
              animate="visible"
              variants={listVariants}
              className="max-h-80 overflow-y-auto"
            >
              {peopleThisWeek.map((p: any, idx: number) => {
                const hrs = Math.round(p.hours)
                return (
                  <motion.li key={idx} variants={itemVariants} className="py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm text-ink">{p.name}</p>
                      <span className="num shrink-0 text-xs text-ink-muted">{hrs}h</span>
                    </div>
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: Math.min(100, (p.hours / maxWeekHours) * 100) + "%" }}
                        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1], delay: idx * 0.02 }}
                        className="h-full rounded-full bg-accent"
                      />
                    </div>
                  </motion.li>
                )
              })}
            </motion.ul>
          )}
        </Card>

        {/* Recent activity */}
        <Card title="Recent activity" padded={false}>
          {overviewData.recentActivity.length === 0 ? (
            <Quiet line="No recent sign-in activity." />
          ) : (
            <motion.ul initial="hidden" animate="visible" variants={listVariants}>
              {overviewData.recentActivity.map((ev: any, idx: number) => (
                <Row key={idx}>
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        ev.type === "in" ? "bg-accent" : "bg-ink-subtle"
                      }`}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ink">
                        {ev.name}{" "}
                        <span className="text-ink-muted">
                          signed {ev.type === "in" ? "in" : "out"}
                        </span>
                      </p>
                      <p className="truncate text-xs text-ink-muted" title={ev.jobName}>
                        {ev.jobName}
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="num text-xs text-ink">
                      {formatTime(ev.time)}
                    </p>
                    <p className="num text-[10px] text-ink-subtle">
                      {formatIn(ev.time, { day: "numeric", month: "short" })}
                    </p>
                  </div>
                </Row>
              ))}
            </motion.ul>
          )}
        </Card>
      </div>
    </PageTransition>
  )
}

/**
 * Share the team's join link over WhatsApp.
 *
 * WhatsApp because that is where a crew already is. The alternative -- type six
 * email addresses into an invite form -- is the step at which a free trial
 * stops having any workers on it, and a supervisor standing in a site cabin is
 * not going to do it.
 *
 * The link is fetched on press rather than on mount: most visits to this page
 * are not invitations, and minting a token for every one of them is work
 * nobody asked for.
 */
function ShareInviteButton() {
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function share() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/invite-link")
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.url) {
        setError(data?.error || "Could not build an invite link.")
        return
      }
      const text =
        `Join ${data.companyName} on Vantro. Tap the link, put your name in, ` +
        `and you are signed in: ${data.url}`
      // wa.me with no number opens the contact picker, which is what "share
      // with the lads" means -- it is not a message to one known person.
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener")
    } catch {
      setError("Could not reach Vantro. Check your connection.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <Button variant="secondary" size="sm" onClick={share} disabled={busy}>
        <Share2 size={14} className="text-accent-ink" />
        {busy ? "Building link…" : "Share invite on WhatsApp"}
      </Button>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  )
}

/**
 * Free-plan line. One sentence, one link, no box: it sits between the title
 * and the figures, and must not compete with either.
 */
function FreePlanLine({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const days = historyDays("free")
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
      <span className="rounded-full border border-line bg-surface-1 px-2 py-0.5 font-medium text-ink">
        Free
      </span>
      <span>
        Sign in is geofenced, so these hours are verified. History kept{" "}
        <span className="num">{days}</span> days — older shifts are deleted nightly.
        Payroll export and QR codes need a paid plan.
      </span>
      <button
        type="button"
        onClick={() => onNavigate("billing")}
        className="group inline-flex items-center gap-1 font-medium text-accent-ink transition-colors duration-fast ease-out hover:text-ink"
      >
        See plans
        <ArrowRight
          size={12}
          className="transition-transform duration-fast ease-out group-hover:translate-x-0.5"
        />
      </button>
    </div>
  )
}

/** One of the three figures in the hours card. */
function Figure({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className="t-num mt-1.5 text-[22px] leading-none text-ink">{value}</p>
    </div>
  )
}

/**
 * Empty state inside a card. Softer than the page-level EmptyState: less
 * vertical air, because a card has its own edges to do the framing.
 */
function Quiet({
  line,
  actionLabel,
  onAction,
}: {
  line: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 pb-8 pt-4 text-center">
      <p className="max-w-[34ch] text-sm leading-relaxed text-ink-muted">{line}</p>
      {actionLabel && onAction && (
        <Button variant="secondary" size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  )
}
