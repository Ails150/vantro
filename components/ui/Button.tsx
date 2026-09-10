"use client"

import * as React from "react"

// Exactly three variants exist by design -- primary, secondary, ghost.
// Anything that previously rendered as a fourth style (tinted, outline-danger,
// pill, link-button) maps onto one of these. `tone="danger"` is a modifier for
// destructive intent, not a fourth variant.
type Variant = "primary" | "secondary" | "ghost"
type Size = "sm" | "md"

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  tone?: "default" | "danger"
}

const base =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium " +
  "whitespace-nowrap select-none transition-colors duration-fast ease-out " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink/30 " +
  "focus-visible:ring-offset-1 focus-visible:ring-offset-canvas " +
  "disabled:opacity-45 disabled:pointer-events-none"

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-10 px-4 text-sm",
}

const variants: Record<Variant, string> = {
  primary: "bg-accent text-white shadow-elev hover:bg-accent-ink",
  secondary: "bg-canvas text-ink border border-line-strong hover:bg-surface-hover",
  ghost: "bg-transparent text-ink-muted hover:bg-surface-hover hover:text-ink",
}

const dangerVariants: Record<Variant, string> = {
  primary: "bg-danger text-white shadow-elev hover:brightness-95",
  secondary: "bg-canvas text-danger border border-danger/30 hover:bg-danger-wash",
  ghost: "bg-transparent text-danger hover:bg-danger-wash",
}

export function Button({
  variant = "secondary",
  size = "md",
  tone = "default",
  className = "",
  type = "button",
  ...props
}: ButtonProps) {
  const look = tone === "danger" ? dangerVariants[variant] : variants[variant]
  return (
    <button type={type} className={`${base} ${sizes[size]} ${look} ${className}`} {...props} />
  )
}

export default Button
