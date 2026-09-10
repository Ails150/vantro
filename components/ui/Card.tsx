"use client"

import * as React from "react"

/**
 * The dashboard's one container.
 *
 * A card is white on the off-white page ground, with a 1px hairline and a 12px
 * radius. No shadow: the surface step plus the hairline already separate it,
 * and stacking elevation on top is what made the old grid read as a pile of
 * boxes rather than a dashboard.
 *
 * `padded` is opt-out because list cards want their rows to run edge to edge
 * so the hairlines between them reach the card border.
 */
export function Card({
  title,
  actions,
  children,
  className = "",
  padded = true,
}: {
  title?: string
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
  padded?: boolean
}) {
  return (
    <section
      className={`overflow-hidden rounded-xl border border-line bg-surface-1 ${className}`}
    >
      {(title || actions) && (
        <header className="flex items-center justify-between gap-4 px-4 pt-4 pb-3">
          {title && <h2 className="t-section-title text-ink">{title}</h2>}
          {actions}
        </header>
      )}
      <div className={padded ? "px-4 pb-4" : "pb-0"}>{children}</div>
    </section>
  )
}

/**
 * A stat tile: label above, figure below, one small line of context under
 * that. Fixed three-line structure, so a row of tiles keeps a common baseline
 * whether or not every tile has something to say.
 */
export function StatTile({
  label,
  value,
  foot,
  onClick,
}: {
  label: string
  value: React.ReactNode
  foot?: React.ReactNode
  onClick?: () => void
}) {
  const Tag: any = onClick ? "button" : "div"
  return (
    <Tag
      onClick={onClick}
      className={`block rounded-xl border border-line bg-surface-1 p-4 text-left transition-colors duration-fast ease-out ${
        onClick
          ? "cursor-pointer hover:border-line-strong hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink/30"
          : ""
      }`}
    >
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className="t-num mt-2 text-[28px] leading-none text-ink">{value}</p>
      <div className="mt-2 h-4 text-xs leading-4 text-ink-subtle">{foot}</div>
    </Tag>
  )
}

/**
 * Icon in a tinted circle. The rule for the whole overview: colour lands on
 * the icon and nowhere else -- never a tinted row, never a coloured label.
 */
export function IconCircle({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "accent" | "warn" | "danger"
  children: React.ReactNode
}) {
  const tones: Record<string, string> = {
    neutral: "bg-surface text-ink-subtle",
    accent: "bg-accent-wash text-accent-ink",
    warn: "bg-warn-wash text-warn",
    danger: "bg-danger-wash text-danger",
  }
  return (
    <span
      aria-hidden
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${tones[tone]}`}
    >
      {children}
    </span>
  )
}

/** Initials avatar. Neutral by default -- it is an identifier, not a status. */
export function Avatar({ initials, tone = "neutral" }: { initials: string; tone?: "neutral" | "accent" }) {
  return (
    <span
      aria-hidden
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-medium ${
        tone === "accent" ? "bg-accent-wash text-accent-ink" : "bg-surface text-ink-muted"
      }`}
    >
      {initials}
    </span>
  )
}

export default Card
