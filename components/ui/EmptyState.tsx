"use client"

import * as React from "react"
import { Button } from "./Button"

// Empty states are one line of copy and at most one call to action.
// No illustration, no stacked paragraphs, no secondary "learn more" link --
// the brief calls for a single illustration-free line and one CTA.
export function EmptyState({
  line,
  actionLabel,
  onAction,
}: {
  line: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <p className="text-sm text-ink-muted">{line}</p>
      {actionLabel && onAction && (
        <Button variant="secondary" size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  )
}

/** Same rules, sized to sit inside a table body. */
export function EmptyRow({
  colSpan,
  line,
  actionLabel,
  onAction,
}: {
  colSpan: number
  line: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <tr>
      <td colSpan={colSpan}>
        <EmptyState line={line} actionLabel={actionLabel} onAction={onAction} />
      </td>
    </tr>
  )
}

export default EmptyState
