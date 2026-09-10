"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { Bell } from "lucide-react"
import { SideNav, type NavGroup } from "@/components/ui/SideNav"
import { transitionFast } from "@/components/ui/motion"

/**
 * Admin chrome: header, sidebar, content column.
 *
 * Presentational only. It owns no data and no tab-render branches -- those
 * stay in AdminDashboard. Splitting the chrome out is what let the sidebar be
 * restyled without touching 2,500 lines of tab rendering.
 *
 * The header is 56px, hairline-bottomed, and holds four things and no more:
 * mark plus company name on the left; on-site pill, notifications and account
 * on the right. The product's one claim is knowing who is on site right now,
 * so that number rides in the header on every tab.
 *
 * The page ground is surface-0 (off-white) while cards are surface-1 (white).
 * That single step is what lets a card be a card without a drop shadow.
 */
export function AdminShell({
  groups,
  activeId,
  onSelect,
  collapsed,
  onToggleCollapsed,
  expandedGroups,
  onToggleGroup,
  onSiteCount,
  companyName,
  notificationCount = 0,
  onNotifications,
  headerRight,
  banner,
  children,
}: {
  groups: NavGroup[]
  activeId: string
  onSelect: (id: string) => void
  collapsed: boolean
  onToggleCollapsed: () => void
  expandedGroups: Record<string, boolean>
  onToggleGroup: (key: string) => void
  onSiteCount: number
  companyName?: string
  notificationCount?: number
  onNotifications?: () => void
  headerRight?: React.ReactNode
  banner?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div data-testid="admin-shell" className="min-h-screen bg-surface-0 text-ink">
      {banner}

      <header className="sticky top-0 z-30 border-b border-line bg-surface-1/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between gap-4 px-4 md:px-8">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent"
            >
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                <rect x="2" y="2" width="7" height="7" rx="1.5" fill="white" />
                <rect x="11" y="2" width="7" height="7" rx="1.5" fill="white" opacity="0.7" />
                <rect x="2" y="11" width="7" height="7" rx="1.5" fill="white" opacity="0.7" />
                <rect x="11" y="11" width="7" height="7" rx="1.5" fill="white" opacity="0.4" />
              </svg>
            </span>
            <span className="text-[15px] font-semibold leading-none tracking-tight text-ink">
              Vantro
            </span>
            {companyName && (
              <>
                <span aria-hidden className="h-4 w-px shrink-0 bg-line-strong" />
                <span className="truncate text-[13px] leading-none text-ink-muted" title={companyName}>
                  {companyName}
                </span>
              </>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <OnSitePill count={onSiteCount} />
            {onNotifications && (
              <button
                type="button"
                onClick={onNotifications}
                aria-label={
                  notificationCount > 0
                    ? `Notifications, ${notificationCount} unresolved`
                    : "Notifications"
                }
                title="Notifications"
                className="relative inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-subtle transition-colors duration-fast ease-out hover:bg-surface-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink/30"
              >
                <Bell size={16} />
                {notificationCount > 0 && (
                  <span
                    aria-hidden
                    className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-danger ring-2 ring-surface-1"
                  />
                )}
              </button>
            )}
            {headerRight}
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1600px]">
        <SideNav
          groups={groups}
          activeId={activeId}
          onSelect={onSelect}
          collapsed={collapsed}
          onToggleCollapsed={onToggleCollapsed}
          expandedGroups={expandedGroups}
          onToggleGroup={onToggleGroup}
        />

        <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  )
}

/**
 * The on-site pill. The one place accent colour is allowed to pulse, and the
 * single orchestrated motion moment the brief asks for -- the count animates
 * when it changes and nothing else on the page moves.
 */
function OnSitePill({ count }: { count: number }) {
  const live = count > 0
  return (
    <div className="flex items-center gap-2 rounded-full border border-line bg-surface-0 py-1 pl-2.5 pr-3">
      <span className="relative flex h-1.5 w-1.5" aria-hidden>
        {live && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
        )}
        <span
          className={`relative inline-flex h-1.5 w-1.5 rounded-full ${
            live ? "bg-accent" : "bg-ink-subtle"
          }`}
        />
      </span>
      <p className="text-[13px] leading-none text-ink-muted">
        <motion.span
          key={count}
          initial={{ opacity: 0, y: -2 }}
          animate={{ opacity: 1, y: 0 }}
          transition={transitionFast}
          className="t-num inline-block text-[13px] text-ink"
        >
          {count}
        </motion.span>{" "}
        on site
      </p>
    </div>
  )
}

export default AdminShell
