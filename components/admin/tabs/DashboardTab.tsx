"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { ArrowRight } from "lucide-react"
import { isFieldOrSupervisor } from "@/lib/roles"
import { PageTransition, PageHeader, Section, Stat } from "@/components/ui/Page"
import { EmptyState } from "@/components/ui/EmptyState"
import { listVariants, itemVariants } from "@/components/ui/motion"

// Overview tab, lifted out of AdminDashboard with its behaviour unchanged.
// Every figure still comes from the `overviewData` memo computed by the parent;
// nothing here fetches, and no query was touched.
//
// Visually this drops the previous six-card grid (rounded-2xl + border + shadow
// on every zone). Zones are now separated by hairlines and whitespace, which is
// what makes a dashboard read as one surface rather than a pile of boxes.

type Props = {
  overviewData: any
  teamMembers: any[]
  pendingQA: any[]
  onNavigate: (tab: string) => void
}

const severityDot: Record<string, string> = {
  high: "bg-danger",
  medium: "bg-warn",
  low: "bg-ink-subtle",
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

/** A row in one of the overview lists. Hairline separated, hover feedback. */
function Row({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <motion.li
      variants={itemVariants}
      onClick={onClick}
      className={`flex items-center justify-between gap-4 border-b border-line py-3 last:border-0 transition-colors duration-fast ease-out hover:bg-surface-hover ${
        onClick ? "cursor-pointer" : ""
      }`}
    >
      {children}
    </motion.li>
  )
}

export default function DashboardTab({ overviewData, teamMembers, pendingQA, onNavigate }: Props) {
  const peopleThisWeek = React.useMemo(() => {
    return (teamMembers || [])
      .filter((m: any) => isFieldOrSupervisor(m.role) && m.is_active !== false)
      .map((m: any) => ({ name: m.name, hours: overviewData.installerHoursThisWeek[m.id] || 0 }))
      .sort((a: any, b: any) => b.hours - a.hours)
  }, [teamMembers, overviewData.installerHoursThisWeek])

  const tiles = [
    { label: "QA approvals", value: pendingQA.length, tab: "approvals" },
    { label: "Open alerts", value: overviewData.unresolvedAlertCount, tab: "alerts" },
    { label: "Alerts >7d", value: overviewData.oldAlertCount, tab: "alerts" },
    { label: "Jobs completed", value: overviewData.jobsCompletedThisWeek, tab: "jobs" },
  ]

  const maxWeekHours = Math.max(...peopleThisWeek.map((p: any) => p.hours), 40)
  const sparkMax = Math.max(...overviewData.sparkline, 1)

  return (
    <PageTransition>
      <PageHeader title="Overview" description="What needs you today, and where the work stands." />

      {/* Headline figures. The display face is used here and in the page title only. */}
      <div className="grid grid-cols-2 gap-6 border-t border-line pt-6 md:grid-cols-4">
        {tiles.map((t) => (
          <Stat key={t.label} label={t.label} value={t.value} onClick={() => onNavigate(t.tab)} />
        ))}
      </div>

      {/* Action queue */}
      <Section title="Needs you today" className="mt-8">
        {overviewData.actionItems.length === 0 ? (
          <EmptyState line="Nothing needs your attention right now." />
        ) : (
          <motion.ul initial="hidden" animate="visible" variants={listVariants}>
            {overviewData.actionItems.map((item: any) => (
              <Row key={item.key} onClick={() => onNavigate(item.tab)}>
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      severityDot[item.severity] || severityDot.low
                    }`}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink">{item.label}</p>
                    {item.sub && <p className="mt-0.5 truncate text-xs text-ink-muted">{item.sub}</p>}
                  </div>
                </div>
                <ArrowRight size={14} className="shrink-0 text-ink-subtle" />
              </Row>
            ))}
          </motion.ul>
        )}
      </Section>

      <div className="mt-8 grid grid-cols-1 gap-8 md:grid-cols-2">
        {/* On site now */}
        <Section title="On site now" actions={<GoTo label="Map" onClick={() => onNavigate("map")} />}>
          {overviewData.onSiteNow.length === 0 ? (
            <EmptyState line="Nobody signed in yet today." />
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
                  Math.floor((Date.now() - new Date(p.signedInAt).getTime()) / 60000)
                )
                const h = Math.floor(mins / 60)
                const m = mins % 60
                return (
                  <Row key={idx}>
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-wash text-[11px] font-medium text-accent-ink">
                        {p.initials}
                      </span>
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
        </Section>

        {/* Hours today */}
        <Section title="Hours today">
          <div className="flex items-end justify-between gap-6">
            <Stat label="Live" value={overviewData.liveHours + "h"} />
            <Stat label="Signed out" value={overviewData.todayHours + "h"} />
            <Stat label="This week" value={overviewData.hoursThisWeek + "h"} />
          </div>
          <div className="mt-6 flex h-12 items-end gap-1">
            {overviewData.sparkline.map((v: number, idx: number) => {
              const isToday = idx === overviewData.sparkline.length - 1
              return (
                <div key={idx} className="flex h-full flex-1 flex-col justify-end" title={v + "h"}>
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: (v / sparkMax) * 100 + "%" }}
                    transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1], delay: idx * 0.02 }}
                    className={`w-full rounded-sm ${isToday ? "bg-accent" : "bg-line-strong"}`}
                  />
                </div>
              )
            })}
          </div>
          <div className="mt-1 flex gap-1">
            {overviewData.sparklineLabels.map((lbl: string, idx: number) => (
              <div
                key={idx}
                className={`flex-1 text-center text-[10px] ${
                  idx === overviewData.sparklineLabels.length - 1
                    ? "text-accent-ink"
                    : "text-ink-subtle"
                }`}
              >
                {lbl}
              </div>
            ))}
          </div>
        </Section>
      </div>

      {/* Not signed in yet */}
      {overviewData.attendanceWithTime.length > 0 && (
        <Section
          title="Not signed in yet"
          className="mt-8"
          actions={
            <span className="num text-xs text-ink-muted">
              {overviewData.attendanceWithTime.length}
            </span>
          }
        >
          <p className="-mt-2 mb-3 text-xs text-ink-muted">
            Assigned to active jobs but no sign-in recorded today
          </p>
          <motion.ul initial="hidden" animate="visible" variants={listVariants}>
            {overviewData.attendanceWithTime.slice(0, 9).map((g: any, idx: number) => (
              <Row key={idx}>
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink" title={g.installerName}>
                    {g.installerName}
                  </p>
                  <p className="truncate text-xs text-ink-muted" title={g.jobName}>
                    {g.jobName}
                  </p>
                </div>
                {g.minsLate > 0 && (
                  <span className="num shrink-0 text-xs font-medium text-warn">
                    {g.minsLate}m late
                  </span>
                )}
              </Row>
            ))}
          </motion.ul>
          {overviewData.attendanceWithTime.length > 9 && (
            <p className="mt-2 text-xs text-ink-subtle">
              + {overviewData.attendanceWithTime.length - 9} more
            </p>
          )}
        </Section>
      )}

      {/* Jobs at a glance */}
      <Section
        title="Jobs at a glance"
        className="mt-8"
        actions={<GoTo label="All jobs" onClick={() => onNavigate("jobs")} />}
      >
        {overviewData.jobRAG.length === 0 ? (
          <EmptyState
            line="No active jobs yet."
            actionLabel="Create a job"
            onAction={() => onNavigate("jobs")}
          />
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
      </Section>

      <div className="mt-8 grid grid-cols-1 gap-8 md:grid-cols-2">
        {/* People this week */}
        <Section
          title="People this week"
          actions={<GoTo label="Payroll" onClick={() => onNavigate("payroll")} />}
        >
          {peopleThisWeek.length === 0 ? (
            <EmptyState
              line="No team members yet."
              actionLabel="Add someone"
              onAction={() => onNavigate("team")}
            />
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
        </Section>

        {/* Recent activity */}
        <Section title="Recent activity">
          {overviewData.recentActivity.length === 0 ? (
            <EmptyState line="No recent sign-in activity." />
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
                      {ev.time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </p>
                    <p className="num text-[10px] text-ink-subtle">
                      {ev.time.toLocaleDateString([], { day: "numeric", month: "short" })}
                    </p>
                  </div>
                </Row>
              ))}
            </motion.ul>
          )}
        </Section>
      </div>
    </PageTransition>
  )
}
