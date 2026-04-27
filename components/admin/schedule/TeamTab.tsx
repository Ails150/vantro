"use client"

import { useEffect, useState } from "react"

type TeamRow = {
  id: string
  name: string
  initials: string
  role: string
  schedule_summary: string
  schedule_source: "default" | "custom"
  entitlement_total_days: number
  entitlement_used_days: number
  entitlement_remaining_days: number
}

type DayPattern = {
  enabled: boolean
  start?: string
  end?: string
}

type WeeklyPattern = {
  mon: DayPattern
  tue: DayPattern
  wed: DayPattern
  thu: DayPattern
  fri: DayPattern
  sat: DayPattern
  sun: DayPattern
}

const DAYS: { key: keyof WeeklyPattern; label: string }[] = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
]

const EMPTY_PATTERN: WeeklyPattern = {
  mon: { enabled: false },
  tue: { enabled: false },
  wed: { enabled: false },
  thu: { enabled: false },
  fri: { enabled: false },
  sat: { enabled: false },
  sun: { enabled: false },
}

type Filter = "all" | "default" | "custom"

export default function TeamTab() {
  const [rows, setRows] = useState<TeamRow[]>([])
  const [counts, setCounts] = useState({ total: 0, default: 0, custom: 0 })
  const [filter, setFilter] = useState<Filter>("all")
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<TeamRow | null>(null)

  async function load() {
    setLoading(true)
    const res = await fetch("/api/admin/team-schedules").then((r) => r.json())
    setRows(res?.users || [])
    setCounts(res?.counts || { total: 0, default: 0, custom: 0 })
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const visible = rows.filter((r) => {
    if (filter === "default" && r.schedule_source !== "default") return false
    if (filter === "custom" && r.schedule_source !== "custom") return false
    if (search && !r.name.toLowerCase().includes(search.toLowerCase()))
      return false
    return true
  })

  return (
    <div className="space-y-3">
      {/* Filter row */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5">
          <FilterChip
            active={filter === "all"}
            onClick={() => setFilter("all")}
            label={`All ${counts.total}`}
          />
          <FilterChip
            active={filter === "default"}
            onClick={() => setFilter("default")}
            label={`Default ${counts.default}`}
          />
          <FilterChip
            active={filter === "custom"}
            onClick={() => setFilter("custom")}
            label={`Custom ${counts.custom}`}
          />
        </div>
        <input
          type="text"
          placeholder="Search installer..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-1.5 border border-gray-200 rounded-md text-sm w-56 focus:outline-none focus:border-teal-400"
        />
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading team...</div>
      ) : visible.length === 0 ? (
        <div className="text-center py-12 text-gray-400">No installers match.</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <div className="grid grid-cols-[32px_1fr_220px_100px_80px] gap-3 px-5 py-3 border-b border-gray-100 text-[11px] uppercase tracking-wide text-gray-500">
            <div></div>
            <div>Name</div>
            <div>Schedule</div>
            <div>Source</div>
            <div></div>
          </div>
          {visible.map((r) => (
            <div
              key={r.id}
              className={
                "grid grid-cols-[32px_1fr_220px_100px_80px] gap-3 px-5 py-3 border-b border-gray-100 last:border-0 items-center text-sm " +
                (r.schedule_source === "custom" ? "bg-amber-50" : "")
              }
            >
              <div
                className={
                  "w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium " +
                  (r.schedule_source === "custom"
                    ? "bg-amber-100 text-amber-800"
                    : "bg-teal-50 text-teal-800")
                }
              >
                {r.initials}
              </div>
              <div>
                <div>{r.name}</div>
                <div className="text-[11px] text-gray-500 mt-0.5 capitalize">
                  {r.role}
                </div>
              </div>
              <div
                className={
                  "text-xs " +
                  (r.schedule_source === "custom"
                    ? "text-amber-800"
                    : "text-gray-500")
                }
              >
                {r.schedule_summary}
              </div>
              <div
                className={
                  "text-xs " +
                  (r.schedule_source === "custom"
                    ? "text-amber-800 font-medium"
                    : "text-gray-500")
                }
              >
                {r.schedule_source === "custom" ? "Custom" : "Default"}
              </div>
              <button
                onClick={() => setEditing(r)}
                className={
                  "px-3 py-1 rounded-md text-[11px] border " +
                  (r.schedule_source === "custom"
                    ? "bg-white border-amber-300 text-amber-800"
                    : "bg-white border-gray-200")
                }
              >
                {r.schedule_source === "custom" ? "Edit" : "Override"}
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="text-xs text-gray-500 px-1">
        Click "Edit" or "Override" to set a custom pattern. Custom schedules
        fully replace the default for that installer.
      </div>

      {editing && (
        <OverrideModal
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            load()
          }}
        />
      )}
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className={
        "px-3 py-1.5 rounded-md text-xs font-medium border transition-colors " +
        (active
          ? "bg-teal-400 text-white border-teal-400"
          : "bg-white text-gray-600 border-gray-200 hover:border-teal-300")
      }
    >
      {label}
    </button>
  )
}

function OverrideModal({
  row,
  onClose,
  onSaved,
}: {
  row: TeamRow
  onClose: () => void
  onSaved: () => void
}) {
  const [pattern, setPattern] = useState<WeeklyPattern>(EMPTY_PATTERN)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/admin/team/schedule?userId=${row.id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.weekly_pattern) {
          setPattern({ ...EMPTY_PATTERN, ...d.weekly_pattern })
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [row.id])

  function toggleDay(day: keyof WeeklyPattern) {
    setPattern((prev) => {
      const cur = prev[day]
      if (cur.enabled) return { ...prev, [day]: { ...cur, enabled: false } }
      return {
        ...prev,
        [day]: {
          enabled: true,
          start: cur.start || "08:00",
          end: cur.end || "17:00",
        },
      }
    })
  }

  function updateTime(
    day: keyof WeeklyPattern,
    field: "start" | "end",
    value: string
  ) {
    setPattern((prev) => ({
      ...prev,
      [day]: { ...prev[day], [field]: value },
    }))
  }

  async function save(reset = false) {
    setSaving(true)
    setError(null)
    const body = {
      userId: row.id,
      weekly_pattern: reset ? EMPTY_PATTERN : pattern,
    }
    const res = await fetch("/api/admin/team/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    setSaving(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(j.error || "Save failed")
      return
    }
    onSaved()
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-lg w-full max-w-xl max-h-[90vh] overflow-y-auto"
      >
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <div className="font-semibold">{row.name}</div>
            <div className="text-xs text-gray-500 mt-0.5 capitalize">
              {row.role} · custom schedule
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-xl leading-none"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-4 space-y-2">
          {loading ? (
            <div className="text-center py-12 text-gray-400">Loading...</div>
          ) : (
            DAYS.map((d) => {
              const day = pattern[d.key]
              return (
                <div
                  key={d.key}
                  className={
                    "grid grid-cols-[32px_90px_1fr] gap-3 items-center py-1.5 " +
                    (day.enabled ? "" : "opacity-60")
                  }
                >
                  <button
                    type="button"
                    onClick={() => toggleDay(d.key)}
                    className={
                      "relative inline-flex h-5 w-9 items-center rounded-full transition-colors " +
                      (day.enabled ? "bg-teal-400" : "bg-gray-300")
                    }
                  >
                    <span
                      className={
                        "inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform " +
                        (day.enabled ? "translate-x-5" : "translate-x-0.5")
                      }
                    />
                  </button>
                  <span
                    className={
                      "text-sm " +
                      (day.enabled ? "text-gray-900 font-medium" : "text-gray-400")
                    }
                  >
                    {d.label}
                  </span>
                  {day.enabled ? (
                    <div className="flex items-center gap-2 text-sm">
                      <input
                        type="time"
                        value={day.start || "08:00"}
                        onChange={(e) =>
                          updateTime(d.key, "start", e.target.value)
                        }
                        className="rounded-md px-2 py-1 border border-gray-200 bg-gray-50 focus:outline-none focus:border-teal-400"
                      />
                      <span className="text-gray-400">→</span>
                      <input
                        type="time"
                        value={day.end || "17:00"}
                        onChange={(e) =>
                          updateTime(d.key, "end", e.target.value)
                        }
                        className="rounded-md px-2 py-1 border border-gray-200 bg-gray-50 focus:outline-none focus:border-teal-400"
                      />
                    </div>
                  ) : (
                    <span className="text-sm text-gray-400 italic">Off</span>
                  )}
                </div>
              )
            })
          )}
        </div>
        <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between">
          <button
            onClick={() => save(true)}
            disabled={saving}
            className="text-sm text-gray-500 hover:text-gray-800 disabled:opacity-50"
          >
            Reset to default
          </button>
          <div className="flex items-center gap-3">
            {error && <span className="text-sm text-red-500">{error}</span>}
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-xl border border-gray-200 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={() => save()}
              disabled={saving}
              className="px-5 py-2 text-sm font-medium bg-teal-400 hover:bg-teal-500 text-white rounded-xl disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save override"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
