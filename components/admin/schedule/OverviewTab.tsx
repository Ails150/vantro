"use client"

import { useEffect, useState } from "react"

type OverviewData = {
  today: string
  week_start: string
  week_end: string
  country_code: string
  kpis: {
    team_size: number
    working_today: number
    on_time_off_today: number
    off_by_type: Record<string, number>
    pending_approval_count: number
    custom_schedule_count: number
  }
  next_public_holiday: { name: string; holiday_date: string } | null
  week_time_off: Array<{
    id: string
    type: string
    start_date: string
    end_date: string
    is_half_day: boolean
    users: { name: string | null; full_name: string | null; initials: string | null }
  }>
  pending_preview: Array<{
    id: string
    type: string
    start_date: string
    end_date: string
    created_at: string
    users: { name: string | null; full_name: string | null; initials: string | null }
  }>
  entitlement: { total_days: number; used_days: number }
}

const TYPE_LABEL: Record<string, string> = {
  annual_leave: "Annual leave",
  sick: "Sick",
  personal: "Personal",
  bereavement: "Bereavement",
  training: "Training",
  unpaid: "Unpaid",
  unavailable: "Unavailable",
}

function formatDateShort(iso: string) {
  const d = new Date(iso + "T00:00:00")
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

function formatRange(start: string, end: string) {
  if (start === end) return formatDateShort(start)
  return `${formatDateShort(start)} – ${formatDateShort(end)}`
}

function daysAway(iso: string) {
  const target = new Date(iso + "T00:00:00").getTime()
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.round((target - today.getTime()) / 86400000)
  if (diff < 0) return "passed"
  if (diff === 0) return "today"
  if (diff === 1) return "tomorrow"
  return `${diff} days away`
}

export default function OverviewTab() {
  const [data, setData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/admin/schedule-overview")
      .then((r) => r.json())
      .then((d) => {
        setData(d)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  if (loading)
    return <div className="text-center py-12 text-gray-400">Loading overview...</div>
  if (!data)
    return <div className="text-center py-12 text-gray-400">Unable to load overview.</div>

  const offByTypeText = Object.entries(data.kpis.off_by_type)
    .map(([k, n]) => `${n} ${TYPE_LABEL[k]?.toLowerCase() || k}`)
    .join(", ")

  return (
    <div className="space-y-3">
      {/* KPI row */}
      <div className="grid grid-cols-4 gap-3">
        <Kpi
          label="Working today"
          value={`${data.kpis.working_today} / ${data.kpis.team_size}`}
          sub={
            data.kpis.team_size > 0
              ? `${Math.round(
                  (data.kpis.working_today / data.kpis.team_size) * 100
                )}% of team`
              : "—"
          }
        />
        <Kpi
          label="On time off"
          value={`${data.kpis.on_time_off_today}`}
          sub={offByTypeText || "no one off today"}
        />
        <Kpi
          label="Pending approval"
          value={`${data.kpis.pending_approval_count}`}
          sub="awaiting decision"
          warn={data.kpis.pending_approval_count > 0}
        />
        <Kpi
          label="Custom schedules"
          value={`${data.kpis.custom_schedule_count} / ${data.kpis.team_size}`}
          sub="overriding default"
        />
      </div>

      {/* Pending banner */}
      {data.kpis.pending_approval_count > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-amber-900">
              {data.kpis.pending_approval_count} time-off{" "}
              {data.kpis.pending_approval_count === 1 ? "request needs" : "requests need"}{" "}
              approval
            </div>
            <div className="text-xs text-amber-800 mt-0.5">
              Review now to keep the team moving.
            </div>
          </div>
          <button
            onClick={() => {
              try {
                localStorage.setItem("vantro.scheduler.activeTab", "time_off")
              } catch {}
              location.reload()
            }}
            className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-medium"
          >
            Review →
          </button>
        </div>
      )}

      {/* This week */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">This week</div>
            <div className="text-xs text-gray-500 mt-0.5">
              Approved time off · compliance auto-skipped
            </div>
          </div>
        </div>
        {data.week_time_off.length === 0 ? (
          <div className="px-5 py-6 text-sm text-gray-400 text-center">
            No approved time off this week.
          </div>
        ) : (
          data.week_time_off.map((e) => {
            const u = e.users || ({} as any)
            const name = u.name || u.full_name || "(unnamed)"
            const initials = u.initials || name.slice(0, 2).toUpperCase()
            return (
              <div
                key={e.id}
                className="px-5 py-3 border-b border-gray-100 last:border-0 flex items-center justify-between text-sm"
              >
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full bg-purple-100 text-purple-800 flex items-center justify-center text-xs font-medium">
                    {initials}
                  </div>
                  <div>
                    <div>{name}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {TYPE_LABEL[e.type] || e.type}
                      {e.is_half_day ? " (½ day)" : ""}
                    </div>
                  </div>
                </div>
                <span className="text-xs text-gray-500">
                  {formatRange(e.start_date, e.end_date)}
                </span>
              </div>
            )
          })
        )}
      </div>

      {/* Holiday + entitlement */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white border border-gray-200 rounded-2xl px-5 py-4">
          <div className="text-[11px] text-gray-500 mb-1.5 uppercase tracking-wide">
            Next public holiday
          </div>
          {data.next_public_holiday ? (
            <>
              <div className="text-sm font-medium mb-1">
                {data.next_public_holiday.name}
              </div>
              <div className="text-xs text-gray-500">
                {formatDateShort(data.next_public_holiday.holiday_date)} ·{" "}
                {daysAway(data.next_public_holiday.holiday_date)}
              </div>
            </>
          ) : (
            <div className="text-sm text-gray-500">None upcoming</div>
          )}
        </div>
        <div className="bg-white border border-gray-200 rounded-2xl px-5 py-4">
          <div className="text-[11px] text-gray-500 mb-1.5 uppercase tracking-wide">
            Team entitlement used
          </div>
          <div className="text-sm font-medium mb-1">
            {data.entitlement.used_days} / {data.entitlement.total_days} days
          </div>
          <div className="text-xs text-gray-500">
            {data.country_code} ·{" "}
            {data.entitlement.total_days > 0
              ? `${Math.round(
                  (data.entitlement.used_days / data.entitlement.total_days) * 100
                )}% used`
              : "—"}
          </div>
        </div>
      </div>
    </div>
  )
}

function Kpi({
  label,
  value,
  sub,
  warn = false,
}: {
  label: string
  value: string
  sub: string
  warn?: boolean
}) {
  return (
    <div className="bg-gray-50 rounded-xl p-4">
      <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-1">
        {label}
      </div>
      <div
        className={"text-2xl font-medium mb-0.5 " + (warn ? "text-amber-600" : "")}
      >
        {value}
      </div>
      <div className="text-[11px] text-gray-500">{sub}</div>
    </div>
  )
}
