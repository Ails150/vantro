"use client"

import { useEffect, useState } from "react"
import OverviewTab from "@/components/admin/schedule/OverviewTab"
import DefaultsTab from "@/components/admin/schedule/DefaultsTab"
import TeamTab from "@/components/admin/schedule/TeamTab"
import TimeOffTab from "@/components/admin/schedule/TimeOffTab"

type SubTab = "overview" | "defaults" | "team" | "time_off"
const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "defaults", label: "Defaults" },
  { id: "team", label: "Team" },
  { id: "time_off", label: "Time off" },
]

const STORAGE_KEY = "vantro.scheduler.activeTab"

export default function ScheduleTab() {
  const [activeSub, setActiveSub] = useState<SubTab>("overview")
  const [pendingDot, setPendingDot] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored && SUB_TABS.find((t) => t.id === stored)) {
        setActiveSub(stored as SubTab)
      }
    } catch {}
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(STORAGE_KEY, activeSub)
    } catch {}
  }, [activeSub, hydrated])

  useEffect(() => {
    let cancelled = false
    fetch("/api/admin/time-off?status=pending")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        setPendingDot((data?.entries?.length || 0) > 0)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [activeSub])

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Scheduler</h2>
        <p className="text-sm text-gray-500 mt-1">
          Working hours, overrides, time off and entitlements for your team.
        </p>
      </div>

      <div className="flex gap-6 border-b border-gray-200">
        {SUB_TABS.map((t) => {
          const isActive = activeSub === t.id
          const showDot = t.id === "time_off" && pendingDot
          return (
            <button
              key={t.id}
              onClick={() => setActiveSub(t.id)}
              className={
                "py-3 text-sm transition-colors flex items-center gap-2 -mb-px " +
                (isActive
                  ? "border-b-2 border-teal-400 text-teal-700 font-medium"
                  : "text-gray-500 hover:text-gray-800")
              }
            >
              {t.label}
              {showDot && (
                <span className="inline-block w-1.5 h-1.5 bg-teal-500 rounded-full" />
              )}
            </button>
          )
        })}
      </div>

      <div>
        {activeSub === "overview" && <OverviewTab />}
        {activeSub === "defaults" && <DefaultsTab />}
        {activeSub === "team" && <TeamTab />}
        {activeSub === "time_off" && <TimeOffTab />}
      </div>
    </div>
  )
}
