"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { pageVariants } from "./motion"

// Page scaffolding. Layout comes from whitespace and hairlines -- there is no
// card wrapper here on purpose, because the brief rules out boxy card grids.

/** Animated tab panel wrapper. */
export function PageTransition({
  children,
  className = "",
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <motion.div initial="hidden" animate="visible" exit="exit" variants={pageVariants} className={className}>
      {children}
    </motion.div>
  )
}

/** Page title block. The display face appears here and nowhere else. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 pb-6">
      <div className="min-w-0">
        <h1 className="font-display text-2xl leading-tight text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

/** A titled region separated by a hairline rather than boxed in a card. */
export function Section({
  title,
  actions,
  children,
  className = "",
}: {
  title?: string
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={`border-t border-line pt-6 ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex items-center justify-between gap-4">
          {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}

/** Hero figure. The only other place the display face is allowed. */
export function Stat({
  label,
  value,
  hint,
  onClick,
}: {
  label: string
  value: React.ReactNode
  hint?: string
  onClick?: () => void
}) {
  const Tag: any = onClick ? "button" : "div"
  return (
    <Tag
      onClick={onClick}
      className={`block text-left ${onClick ? "group cursor-pointer" : ""}`}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">{label}</p>
      <p className="font-display-num mt-1 text-3xl text-ink group-hover:text-accent-ink transition-colors duration-fast ease-out">
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
    </Tag>
  )
}
