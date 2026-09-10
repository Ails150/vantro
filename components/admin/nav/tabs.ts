// Admin sidebar navigation, as data.
//
// These arrays used to be component locals inside AdminDashboard, which meant
// nothing outside that file could read or filter them. They live here so the
// nav can be filtered by companies.vertical without touching the render.
//
// Badges are declared as a static `badgeKey`, not a count: the counts are live
// props on AdminDashboard and are resolved at render time.
//
// THREE ZONES, not one flat list. A flat list gave Payroll the same visual
// weight as Overview, so a new admin could not tell what to look at first.
//
//   Today   what is happening right now, and what is waiting on you
//   Manage  the records you maintain
//   Setup   configuration you touch once and then rarely again
//
// Tab ids are unchanged and load-bearing: they key the render branches in
// AdminDashboard, the ?tab= query param, the persisted last-tab in
// localStorage, and hiddenTabs in lib/vertical.ts. Only grouping and labels
// moved.

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

export type AdminNavGroup = {
  key: string
  label: string
  /** Collapsed on first load. Setup is, because onboarding is a one-off. */
  defaultCollapsed?: boolean
  items: AdminTab[]
}

/** Counts supplied by AdminDashboard to resolve each tab's badgeKey. */
export type TabBadgeCounts = Record<BadgeKey, number>

/**
 * The landing tab.
 *
 * Kept as the id "overview" rather than renamed to "today": the id is written
 * into ?tab= links, localStorage and hiddenTabs, so renaming it would strand
 * every existing bookmark and stored preference. The label is what changed.
 */
export const DEFAULT_TAB = "overview"

const todayTabs: AdminTab[] = [
  { id: "overview", label: "Today", icon: LayoutDashboard },
  { id: "alerts", label: "Alerts", badgeKey: "alerts", icon: Bell },
  { id: "approvals", label: "QA reviews", badgeKey: "pendingQA", icon: BadgeCheck },
  { id: "map", label: "Live map", icon: Map },
  { id: "diary", label: "Diary", icon: BookOpen },
]

const manageTabs: AdminTab[] = [
  { id: "jobs", label: "Jobs", icon: Briefcase },
  // Trades and Sites are the pair that branches by vertical: install hides
  // Sites, every other vertical hides Trades. Sites lives here, Trades in
  // Setup, because a cleaning firm maintains sites daily and an install firm
  // picks its trades once.
  { id: "sites", label: "Sites", icon: MapPinned },
  { id: "team", label: "Team", icon: Users },
  { id: "subcontractors", label: "Subcontractors", icon: Building2 },
  { id: "schedule", label: "Scheduler", icon: CalendarClock }, // schedule_link_added
  { id: "calendar", label: "Calendar", icon: Calendar }, // calendar_sidebar_marker
  { id: "payroll", label: "Payroll", icon: Banknote },
  { id: "defects", label: "Defects", icon: TriangleAlert },
  { id: "progress", label: "Progress", icon: TrendingUp },
  { id: "walkthroughs", label: "Walk & talks", icon: Footprints },
  { id: "audit", label: "Audit", icon: FileSearch },
]

const setupTabsGroup: AdminTab[] = [
  { id: "trades", label: "Trades", icon: Wrench },
  { id: "checklists", label: "Checklist templates", icon: ListChecks },
  { id: "analytics", label: "Analytics", icon: ChartColumn },
  { id: "performance", label: "Performance", icon: Gauge },
  { id: "settings", label: "Settings", icon: Settings },
  { id: "support", label: "Support", icon: LifeBuoy },
]

export const adminNavGroups: AdminNavGroup[] = [
  { key: "today", label: "Today", items: todayTabs },
  { key: "manage", label: "Manage", items: manageTabs },
  { key: "setup", label: "Setup", defaultCollapsed: true, items: setupTabsGroup },
]

/**
 * Every tab across every group, flattened.
 *
 * Used for "is this id real" checks, which must not care which zone a tab
 * happens to sit in.
 */
export const allTabs: AdminTab[] = adminNavGroups.flatMap(g => g.items)

/** Resolve a tab's badge number from live counts. Undefined means no badge. */
export function tabBadge(tab: AdminTab, counts: TabBadgeCounts): number | undefined {
  return tab.badgeKey ? counts[tab.badgeKey] : undefined
}
