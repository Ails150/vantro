"use client"

import * as React from "react"

// Table conventions, applied uniformly:
//   - header sticks while the body scrolls
//   - NO zebra striping; separation comes from hairlines alone
//   - the whole row responds to hover
//   - numeric cells are right aligned with tabular figures
//
// Horizontal overflow is owned by TableScroll so wide tables scroll inside
// their own container instead of pushing the page sideways.

export function TableScroll({
  children,
  maxHeight = "60vh",
  className = "",
}: {
  children: React.ReactNode
  maxHeight?: string
  className?: string
}) {
  return (
    <div
      className={`relative overflow-x-auto overflow-y-auto rounded-md border border-line ${className}`}
      style={{ maxHeight }}
    >
      {children}
    </div>
  )
}

export function Table({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <table className={`w-full border-collapse text-sm ${className}`}>{children}</table>
}

export function THead({ children }: { children: React.ReactNode }) {
  // sticky + a solid background, otherwise rows show through on scroll.
  return (
    <thead className="sticky top-0 z-10 bg-canvas">
      {children}
      <tr aria-hidden>
        <td colSpan={99} className="p-0">
          <div className="h-px w-full bg-line" />
        </td>
      </tr>
    </thead>
  )
}

export function TH({
  children,
  numeric = false,
  className = "",
}: {
  children?: React.ReactNode
  numeric?: boolean
  className?: string
}) {
  return (
    <th
      scope="col"
      className={`px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-ink-subtle ${
        numeric ? "text-right" : "text-left"
      } ${className}`}
    >
      {children}
    </th>
  )
}

export function TBody({ children }: { children: React.ReactNode }) {
  return <tbody>{children}</tbody>
}

export function TR({
  children,
  onClick,
  className = "",
}: {
  children: React.ReactNode
  onClick?: () => void
  className?: string
}) {
  return (
    <tr
      onClick={onClick}
      className={`border-b border-line last:border-0 transition-colors duration-fast ease-out hover:bg-surface-hover ${
        onClick ? "cursor-pointer" : ""
      } ${className}`}
    >
      {children}
    </tr>
  )
}

export function TD({
  children,
  numeric = false,
  className = "",
  colSpan,
}: {
  children?: React.ReactNode
  numeric?: boolean
  className?: string
  colSpan?: number
}) {
  return (
    <td
      colSpan={colSpan}
      className={`px-4 py-3 align-middle text-ink ${numeric ? "text-right num" : "text-left"} ${className}`}
    >
      {children}
    </td>
  )
}
