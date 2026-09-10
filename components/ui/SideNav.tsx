"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { PanelLeftClose, PanelLeftOpen, ChevronRight, type LucideIcon } from "lucide-react"
import { transitionFast } from "./motion"

export type NavItem = {
  id: string
  label: string
  icon: LucideIcon
  badge?: number
}

export type NavGroup = {
  key: string
  label: string
  items: NavItem[]
}

/**
 * Collapsible sidebar.
 *
 * 240px expanded. Group labels 11px, items 14px.
 *
 * Active state is an accent BAR plus accent TEXT, never a filled block: a 2px
 * rule flush to the left edge and the label in accent ink. The old treatment
 * (bg-teal-100 + a 4px border) read as a chip and fought the layout.
 *
 * The rail sits on the page ground (surface-0) rather than white, so the white
 * cards in the content column are the only white on screen.
 *
 * Collapsed, the rail is icon-only at 64px and labels move to native tooltips.
 */
export function SideNav({
  groups,
  activeId,
  onSelect,
  collapsed,
  onToggleCollapsed,
  expandedGroups,
  onToggleGroup,
}: {
  groups: NavGroup[]
  activeId: string
  onSelect: (id: string) => void
  collapsed: boolean
  onToggleCollapsed: () => void
  expandedGroups: Record<string, boolean>
  onToggleGroup: (key: string) => void
}) {
  return (
    <aside
      className={`relative shrink-0 border-r border-line bg-surface-0 transition-[width] duration-base ease-out ${
        collapsed ? "w-16" : "w-60"
      }`}
    >
      <div className="sticky top-0 max-h-screen overflow-y-auto pb-8">
        <div className="flex h-14 items-center justify-end px-3">
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand" : "Collapse"}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-subtle transition-colors duration-fast ease-out hover:bg-surface-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink/30"
          >
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>

        <nav className={collapsed ? "space-y-6 px-2" : "space-y-6 px-3"}>
          {groups.map((group) => {
            const open = collapsed || expandedGroups[group.key] !== false
            return (
              <div key={group.key}>
                {!collapsed && (
                  <button
                    type="button"
                    onClick={() => onToggleGroup(group.key)}
                    aria-expanded={open}
                    className="mb-1 flex w-full items-center gap-1 px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-ink-subtle transition-colors duration-fast ease-out hover:text-ink-muted"
                  >
                    <ChevronRight
                      size={12}
                      className={`transition-transform duration-fast ease-out ${open ? "rotate-90" : ""}`}
                    />
                    {group.label}
                  </button>
                )}

                {open && (
                  <ul className="space-y-0.5">
                    {group.items.map((item) => {
                      const Icon = item.icon
                      const active = item.id === activeId
                      return (
                        <li key={item.id} className="relative">
                          {active && (
                            <motion.span
                              layoutId="nav-accent-bar"
                              transition={transitionFast}
                              className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-accent"
                            />
                          )}
                          <button
                            type="button"
                            onClick={() => onSelect(item.id)}
                            // Stable hook for tests. Labels collide - a zone
                            // header and a nav item can both read "Today" - so
                            // targeting by accessible name is ambiguous.
                            data-testid={`nav-${item.id}`}
                            title={collapsed ? item.label : undefined}
                            aria-current={active ? "page" : undefined}
                            className={`flex w-full items-center gap-3 rounded-md py-2 text-sm transition-colors duration-fast ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink/30 ${
                              collapsed ? "justify-center px-0" : "px-3"
                            } ${
                              active
                                ? "font-medium text-accent-ink"
                                : "text-ink-muted hover:bg-surface-hover hover:text-ink"
                            }`}
                          >
                            <Icon
                              size={16}
                              className={active ? "text-accent-ink" : "text-ink-subtle"}
                              strokeWidth={active ? 2.25 : 2}
                            />
                            {!collapsed && <span className="truncate">{item.label}</span>}
                            {!collapsed && !!item.badge && (
                              <span className="ml-auto num rounded-full border border-line bg-surface-1 px-1.5 text-[11px] font-medium leading-[17px] text-ink-muted">
                                {item.badge}
                              </span>
                            )}
                            {collapsed && !!item.badge && (
                              <span className="absolute right-2 top-1.5 h-1.5 w-1.5 rounded-full bg-accent" />
                            )}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )
          })}
        </nav>
      </div>
    </aside>
  )
}

export default SideNav
