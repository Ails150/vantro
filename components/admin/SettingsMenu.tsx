"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import AccountModal from "./AccountModal"
import CompanyModal from "./CompanyModal"
import ComplianceModal from "./ComplianceModal"

interface Props {
  user: any
  userData: any
  company: any
  onSiteRulesClick: () => void
  onBillingClick: () => void
}

export default function SettingsMenu({ user, userData, company, onSiteRulesClick, onBillingClick }: Props) {
  const [open, setOpen] = useState(false)
  const [showAccount, setShowAccount] = useState(false)
  const [showCompany, setShowCompany] = useState(false)
  const [showCompliance, setShowCompliance] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const router = useRouter()

  // Header avatar. Falls back to the email's first letter, then to a dash --
  // an empty circle in the header reads as a broken image.
  const initials =
    String(userData?.name || "")
      .split(" ")
      .map((p: string) => p[0] || "")
      .join("")
      .toUpperCase()
      .slice(0, 2) ||
    String(user?.email || "")[0]?.toUpperCase() ||
    "-"

  // Close on click outside
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [open])

  async function handleSignOut() {
    setOpen(false)
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push("/login")
  }

  function go(handler: () => void) {
    return () => {
      setOpen(false)
      handler()
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-surface text-[11px] font-medium text-ink-muted transition-colors duration-fast ease-out hover:bg-surface-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink/30"
        aria-label="Account and settings"
        title={userData?.name || user?.email || "Account"}
      >
        {initials}
      </button>

      {open && (
        <div className="absolute right-0 top-11 w-64 bg-white border border-gray-200 rounded-2xl shadow-xl py-2 z-50">
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="font-semibold text-sm text-gray-900 truncate">{userData?.name || user?.email}</div>
            <div className="text-xs text-gray-500 truncate">{user?.email}</div>
            {company?.name && <div className="text-xs text-gray-400 mt-0.5 truncate">{company.name}</div>}
          </div>

          <button onClick={go(() => setShowAccount(true))} className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50 flex items-center gap-3 text-gray-700">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
            </svg>
            Account
          </button>

          <button onClick={go(() => setShowCompany(true))} className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50 flex items-center gap-3 text-gray-700">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/>
            </svg>
            Company
          </button>

          <button onClick={go(() => setShowCompliance(true))} className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50 flex items-center gap-3 text-gray-700">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 12l2 2 4-4"/><path d="M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9c2.39 0 4.68.94 6.36 2.64"/>
            </svg>
            Compliance
          </button>

          <button onClick={go(onBillingClick)} className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50 flex items-center gap-3 text-gray-700">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>
            </svg>
            Billing & subscription
          </button>

          <button onClick={go(onSiteRulesClick)} className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50 flex items-center gap-3 text-gray-700">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
            Site rules
          </button>

          <div className="border-t border-gray-100 my-1"/>

          <button onClick={handleSignOut} className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50 flex items-center gap-3 text-gray-700">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Sign out
          </button>
        </div>
      )}

      <AccountModal open={showAccount} onClose={() => setShowAccount(false)} user={user} userData={userData} company={company} />
      <CompanyModal open={showCompany} onClose={() => setShowCompany(false)} company={company} />
      <ComplianceModal open={showCompliance} onClose={() => setShowCompliance(false)} />
    </div>
  )
}
