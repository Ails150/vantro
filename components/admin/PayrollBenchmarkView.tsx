import type { Benchmark } from "@/lib/payroll-runs"

/** Below the minimum there is no number on this page, so none can be copied. */
export default function PayrollBenchmarkView({ data }: { data: Benchmark }) {
  return (
    <main className="max-w-xl mx-auto p-8 space-y-4">
      <h1 className="text-2xl font-bold text-ink">Payroll median</h1>
      {data.medianMinutes === null ? (
        <p className="text-sm text-ink">
          Not enough companies yet: {data.companiesCounted} of {data.companiesNeeded}. The median stays hidden until
          there are {data.companiesNeeded}.
        </p>
      ) : (
        <p className="text-sm text-ink">
          Median payroll time: <span className="text-3xl font-bold num">{data.medianMinutes}</span> minutes, across{" "}
          {data.companiesCounted} companies.
        </p>
      )}
      <ul className="text-xs text-ink-muted space-y-1">
        <li>{data.runsCounted} approved payroll runs counted.</li>
        <li>{data.companiesExcluded} demo and test companies left out.</li>
        <li>Each company counts once, as the median of its own weeks.</li>
        <li>This is time taken, from opening a week to approving it. It is not time saved.</li>
      </ul>
    </main>
  )
}
