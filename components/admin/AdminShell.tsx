"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { SideNav, type NavGroup } from "@/components/ui/SideNav"
import { transitionFast } from "@/components/ui/motion"

/**
 * Admin chrome: header, sidebar, content column.
 *
 * Presentational only. It owns no data and no tab-render branches -- those
 * stay in AdminDashboard. Splitting the chrome out is what let the sidebar be
 * restyled without touching 2,500 lines of tab rendering.
 *
 * The header replaces a six-card metric grid that used to sit above the fold.
 * The product's one claim is knowing who is on site right now, so that number
 * leads, as a live strip rather than a box. Everything else the grid showed is
 * one click away in the Today tab, which is where it belongs.
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
  headerRight?: React.ReactNode
  banner?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div data-testid="admin-shell" className="min-h-screen bg-canvas text-ink">
      {banner}

      <header className="sticky top-0 z-30 border-b border-line bg-canvas/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between gap-4 px-4 md:px-8">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="flex h-7 w-7 items-center justify-center rounded-md bg-accent"
            >
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                <rect x="2" y="2" width="7" height="7" rx="1.5" fill="white" />
                <rect x="11" y="2" width="7" height="7" rx="1.5" fill="white" opacity="0.7" />
                <rect x="2" y="11" width="7" height="7" rx="1.5" fill="white" opacity="0.7" />
                <rect x="11" y="11" width="7" height="7" rx="1.5" fill="white" opacity="0.4" />
              </svg>
            </span>
            <span className="font-display text-[15px] leading-none text-ink">Vantro</span>
          </div>

          <div className="flex items-center gap-3">
            <OnSiteIndicator count={onSiteCount} />
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
 * The live strip. The one place accent colour is allowed to pulse, and the
 * single orchestrated motion moment the brief asks for -- the count animates
 * when it changes and nothing else on the page moves.
 */
function OnSiteIndicator({ count }: { count: number }) {
  const live = count > 0
  return (
    <div className="flex items-center gap-2">
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
      <p className="text-sm text-ink-muted">
        <motion.span
          key={count}
          initial={{ opacity: 0, y: -2 }}
          animate={{ opacity: 1, y: 0 }}
          transition={transitionFast}
          className="num inline-block font-medium text-ink"
        >
          {count}
        </motion.span>{" "}
        on site
      </p>
    </div>
  )
}

export default AdminShell
