"use client"

// Loading is always a skeleton, never a spinner. Shapes should approximate the
// content they stand in for so the layout does not jump when data lands.
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded-md bg-line/70 ${className}`}
    />
  )
}

/** Placeholder for a table while rows load. Matches TableRow padding. */
export function SkeletonRows({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-b border-line last:border-0">
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c} className="px-4 py-3">
              <Skeleton className={`h-4 ${c === 0 ? "w-40" : "w-20"}`} />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

/** Placeholder for a stat/summary figure. */
export function SkeletonStat() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-8 w-16" />
    </div>
  )
}

export default Skeleton
