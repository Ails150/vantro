// Admin sidebar navigation, as data.
//
// These arrays used to be component locals inside AdminDashboard, which meant
// nothing outside that file could read or filter them. They live here so the
// nav can later be filtered by companies.vertical without touching the render.
//
// Badges are declared as a static `badgeKey`, not a count: the counts are live
// props on AdminDashboard and are resolved at render time.

import type { LucideIcon } from "lucide-react"
import {
  BadgeCheck, Banknote, Bell, BookOpen, Briefcase, Building2, Calendar,
  CalendarClock, ChartColumn, FileSearch, Footprints, Gauge, LayoutDashboard,
  LifeBuoy, ListChecks, Map, MapPinned, Settings, TrendingUp, TriangleAlert,
  Users, Wrench,
} from "lucide-react"

export type BadgeKey = "alerts" | "pendingQA"

export type AdminTab = {
  id: string
  label: string
  badgeKey?: BadgeKey
  /** Sidebar glyph. Presentational only -- never affects visibility. */
  icon: LucideIcon
}

/** Counts supplied by AdminDashboard to resolve each tab's badgeKey. */
export type TabBadgeCounts = Record<BadgeKey, number>

export const setupTabs: AdminTab[] = [
  { id: "team", label: "Team", icon: Users },
  { id: "subcontractors", label: "Subcontractors", icon: Building2 },
  // Trades and Sites are the pair that branches by vertical: install hides
  // Sites, every other vertical hides Trades. Kept adjacent deliberately.
  { id: "trades", label: "Trades", icon: Wrench },
  { id: "sites", label: "Sites", icon: MapPinned },
  { id: "jobs", label: "Jobs", icon: Briefcase },
  { id: "checklists", label: "Checklist Templates", icon: ListChecks },
  { id: "schedule", label: "Scheduler", icon: CalendarClock }, // schedule_link_added
  { id: "calendar", label: "Calendar", icon: Calendar }, // calendar_sidebar_marker
  { id: "settings", label: "Settings", icon: Settings },
  { id: "support", label: "Support", icon: LifeBuoy },
]

export const operationsTabs: AdminTab[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "alerts", label: "Alerts", badgeKey: "alerts", icon: Bell },
  { id: "approvals", label: "QA Reviews", badgeKey: "pendingQA", icon: BadgeCheck },
  { id: "diary", label: "Diary", icon: BookOpen },
  { id: "progress", label: "Progress", icon: TrendingUp },
  { id: "defects", label: "Defects", icon: TriangleAlert },
  { id: "walkthroughs", label: "Walk & Talks", icon: Footprints },
  { id: "map", label: "Map", icon: Map },
  { id: "analytics", label: "Analytics", icon: ChartColumn },
  { id: "performance", label: "Performance", icon: Gauge },
  { id: "payroll", label: "Payroll", icon: Banknote },
  { id: "audit", label: "Audit", icon: FileSearch },
]

/** Resolve a tab's badge number from live counts. Undefined means no badge. */
export function tabBadge(tab: AdminTab, counts: TabBadgeCounts): number | undefined {
  return tab.badgeKey ? counts[tab.badgeKey] : undefined
}
