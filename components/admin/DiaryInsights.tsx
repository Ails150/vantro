"use client"
import { useEffect, useState } from "react"

type Insights = {
  generated_at: string
  entry_count: number
  cached?: boolean
  insights: {
    recurring_themes: { theme: string; count: number; detail: string }[]
    silent_jobs: { job: string; last_entry: string; detail: string }[]
    unanswered_blockers: { summary: string; count: number }[]
    installer_patterns: { installer: string; pattern: string; detail: string }[]
    trade_signals: { trade: string; signal: string; detail: string }[]
  }
}

export default function DiaryInsights() {
  const [data, setData] = useState<Insights | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  async function load(force = false) {
    if (force) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const url = force ? "/api/admin/diary-insights?refresh=1" : "/api/admin/diary-insights"
      const res = await fetch(url)
      const j = await res.json()
      if (!res.ok) throw new Error(j.detail || j.error || "Failed to load")
      setData(j)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => { load(false) }, [])

  if (loading) {
    return <div className="px-6 py-4 text-sm text-gray-400">Loading insights...</div>
  }

  if (error) {
    return <div className="px-6 py-4 text-sm text-red-500">Insights error: {error}</div>
  }

  if (!data || data.entry_count === 0) {
    return <div className="px-6 py-4 text-sm text-gray-400">No diary entries in the last 7 days.</div>
  }

  const ins = data.insights
  const hasAny =
    ins.recurring_themes.length > 0 ||
    ins.silent_jobs.length > 0 ||
    ins.unanswered_blockers.length > 0 ||
    ins.installer_patterns.length > 0 ||
    ins.trade_signals.length > 0

  return (
    <div className="bg-gradient-to-br from-teal-50 to-purple-50 border border-teal-100 rounded-2xl p-5 mb-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-bold text-gray-800">AI Insights</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Across {data.entry_count} diary entries from the last 7 days
            {data.cached && <span className="ml-2 text-gray-400">· cached</span>}
          </p>
        </div>
        <button onClick={() => load(true)} disabled={refreshing} className="text-xs bg-white border border-gray-200 hover:border-teal-300 rounded-lg px-3 py-1.5 font-medium text-gray-700 disabled:opacity-50">
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {!hasAny ? (
        <div className="text-sm text-gray-500">Nothing notable to report this week — all jobs running clean.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {ins.recurring_themes.length > 0 && (
            <Card title="Recurring themes" tone="red">
              {ins.recurring_themes.map((r, i) => (
                <div key={i} className="text-xs text-gray-700 mb-1.5 last:mb-0">
                  <span className="font-semibold">{r.theme}</span>
                  <span className="ml-1 text-gray-500">×{r.count}</span>
                  <div className="text-gray-500">{r.detail}</div>
                </div>
              ))}
            </Card>
          )}

          {ins.silent_jobs.length > 0 && (
            <Card title="Silent jobs" tone="amber">
              {ins.silent_jobs.map((s, i) => (
                <div key={i} className="text-xs text-gray-700 mb-1.5 last:mb-0">
                  <span className="font-semibold">{s.job}</span>
                  <div className="text-gray-500">{s.detail}</div>
                </div>
              ))}
            </Card>
          )}

          {ins.unanswered_blockers.length > 0 && (
            <Card title="Unanswered blockers" tone="red">
              {ins.unanswered_blockers.map((u, i) => (
                <div key={i} className="text-xs text-gray-700 mb-1.5 last:mb-0">
                  <span className="font-semibold">{u.count} open</span>
                  <div className="text-gray-500">{u.summary}</div>
                </div>
              ))}
            </Card>
          )}

          {ins.installer_patterns.length > 0 && (
            <Card title="Installer patterns" tone="purple">
              {ins.installer_patterns.map((p, i) => (
                <div key={i} className="text-xs text-gray-700 mb-1.5 last:mb-0">
                  <span className="font-semibold">{p.installer}</span>
                  <span className="ml-1 text-gray-500">— {p.pattern}</span>
                  <div className="text-gray-500">{p.detail}</div>
                </div>
              ))}
            </Card>
          )}

          {ins.trade_signals.length > 0 && (
            <Card title="Trade signals" tone="teal">
              {ins.trade_signals.map((t, i) => (
                <div key={i} className="text-xs text-gray-700 mb-1.5 last:mb-0">
                  <span className="font-semibold">{t.trade}</span>
                  <span className="ml-1 text-gray-500">— {t.signal}</span>
                  <div className="text-gray-500">{t.detail}</div>
                </div>
              ))}
            </Card>
          )}
        </div>
      )}
    </div>
  )
}

function Card({ title, tone, children }: { title: string; tone: "red"|"amber"|"purple"|"teal"; children: React.ReactNode }) {
  const toneClass = {
    red: "border-red-200 bg-red-50/50",
    amber: "border-amber-200 bg-amber-50/50",
    purple: "border-purple-200 bg-purple-50/50",
    teal: "border-teal-200 bg-teal-50/50"
  }[tone]
  return (
    <div className={"border rounded-xl p-3 " + toneClass}>
      <div className="text-xs font-bold uppercase tracking-wide text-gray-700 mb-2">{title}</div>
      {children}
    </div>
  )
}
