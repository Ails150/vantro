"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { pageVariants } from "./motion"

// Page scaffolding. The container itself lives in ./Card -- this file is the
// title block, the untitled section wrapper and the plain figure.

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

/** Page title block. Geist 600 at 24px; there is no second face. */
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
        <h1 className="t-page-title text-ink">{title}</h1>
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
          {title && <h2 className="t-section-title text-ink">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}

/** A plain figure, for places that are not the overview tile grid. */
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
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className="t-num mt-1 text-[28px] leading-none text-ink group-hover:text-accent-ink transition-colors duration-fast ease-out">
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
    </Tag>
  )
}
