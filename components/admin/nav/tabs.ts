// Admin sidebar navigation, as data.
//
// These arrays used to be component locals inside AdminDashboard, which meant
// nothing outside that file could read or filter them. They live here so the
// nav can later be filtered by companies.vertical without touching the render.
//
// Badges are declared as a static `badgeKey`, not a count: the counts are live
// props on AdminDashboard and are resolved at render time.

export type BadgeKey = "alerts" | "pendingQA"

export type AdminTab = {
  id: string
  label: string
  badgeKey?: BadgeKey
}

/** Counts supplied by AdminDashboard to resolve each tab's badgeKey. */
export type TabBadgeCounts = Record<BadgeKey, number>

export const setupTabs: AdminTab[] = [
  { id: "team", label: "Team" },
  { id: "subcontractors", label: "Subcontractors" },
  // Trades and Sites are the pair that branches by vertical: install hides
  // Sites, every other vertical hides Trades. Kept adjacent deliberately.
  { id: "trades", label: "Trades" },
  { id: "sites", label: "Sites" },
  { id: "jobs", label: "Jobs" },
  { id: "checklists", label: "Checklist Templates" },
  { id: "schedule", label: "Scheduler" }, // schedule_link_added
  { id: "calendar", label: "Calendar" }, // calendar_sidebar_marker
  { id: "settings", label: "Settings" },
  { id: "support", label: "Support" },
]

export const operationsTabs: AdminTab[] = [
  { id: "overview", label: "Overview" },
  { id: "alerts", label: "Alerts", badgeKey: "alerts" },
  { id: "approvals", label: "QA Reviews", badgeKey: "pendingQA" },
  { id: "diary", label: "Diary" },
  { id: "progress", label: "Progress" },
  { id: "defects", label: "Defects" },
  { id: "walkthroughs", label: "Walk & Talks" },
  { id: "map", label: "Map" },
  { id: "analytics", label: "Analytics" },
  { id: "performance", label: "Performance" },
  { id: "payroll", label: "Payroll" },
  { id: "audit", label: "Audit" },
]

/** Resolve a tab's badge number from live counts. Undefined means no badge. */
export function tabBadge(tab: AdminTab, counts: TabBadgeCounts): number | undefined {
  return tab.badgeKey ? counts[tab.badgeKey] : undefined
}
