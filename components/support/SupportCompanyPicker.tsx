"use client"
import { useMemo, useState } from "react"

type Company = { id: string; name: string }

export default function SupportCompanyPicker({ companies }: { companies: Company[] }) {
  const [search, setSearch] = useState("")
  const [enteringId, setEnteringId] = useState<string | null>(null)
  const [error, setError] = useState("")

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return companies
    return companies.filter(c => (c.name || "").toLowerCase().includes(q))
  }, [companies, search])

  async function enter(c: Company) {
    setEnteringId(c.id); setError("")
    try {
      const res = await fetch("/api/support/enter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: c.id }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error || "Could not open this company")
        setEnteringId(null)
        return
      }
      window.location.href = "/admin"
    } catch {
      setError("Something went wrong. Please try again.")
      setEnteringId(null)
    }
  }

  return (
    <div className="min-h-screen bg-[#0f1923] px-4 py-10">
      <div className="max-w-xl mx-auto">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-2xl">🛟</span>
          <h1 className="text-white text-xl font-semibold">Support — choose a company</h1>
        </div>
        <p className="text-[#8fa3b8] text-sm mb-6">
          You have platform support access. Opening a company is logged (company &amp; time) for GDPR.
        </p>

        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search companies..."
          className="w-full bg-[#1a2635] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-[#4d6478] focus:outline-none focus:border-[#00d4a0]/40 text-sm mb-4"
        />

        {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

        <div className="bg-[#1a2635] border border-white/5 rounded-2xl divide-y divide-white/5">
          {filtered.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-[#4d6478]">No companies found</div>
          ) : (
            filtered.map(c => (
              <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="text-white text-sm font-medium truncate">{c.name || "Unnamed company"}</span>
                <button
                  onClick={() => enter(c)}
                  disabled={enteringId !== null}
                  className="bg-[#00d4a0] hover:bg-[#00a87e] disabled:opacity-40 text-[#0f1923] font-semibold rounded-lg px-4 py-2 text-xs transition-colors flex-shrink-0">
                  {enteringId === c.id ? "Opening..." : "Enter"}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
