"use client"

import { useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"

interface Props {
  user: any
  userData: any
  jobs: any[]
  signins: any[]
  alerts: any[]
  pendingQA: any[]
  teamMembers: any[]
}

export default function AdminDashboard({ user, userData, jobs, signins, alerts, pendingQA, teamMembers }: Props) {
  const [activeTab, setActiveTab] = useState("overview")
  const [showAddJob, setShowAddJob] = useState(false)
  const [showAddMember, setShowAddMember] = useState(false)
  const [jobName, setJobName] = useState("")
  const [jobAddress, setJobAddress] = useState("")
  const [memberName, setMemberName] = useState("")
  const [memberEmail, setMemberEmail] = useState("")
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState("")
  const router = useRouter()
  const supabase = createClient()

  const companyName = userData?.companies?.name || "Your Company"

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push("/login")
  }

  async function approveQA(id: string) {
    await supabase.from("qa_submissions").update({ state: "approved", reviewed_at: new Date().toISOString() }).eq("id", id)
    router.refresh()
  }

  async function rejectQA(id: string, note: string) {
    await supabase.from("qa_submissions").update({ state: "rejected", rejection_note: note, reviewed_at: new Date().toISOString() }).eq("id", id)
    router.refresh()
  }

  async function markAlertRead(id: string) {
    await supabase.from("alerts").update({ is_read: true }).eq("id", id)
    router.refresh()
  }

  async function addJob() {
    if (!jobName.trim() || !jobAddress.trim()) { setFormError("Enter job name and address"); return }
    setSaving(true); setFormError("")
    const { error } = await supabase.from("jobs").insert({
      company_id: userData.company_id,
      name: jobName.trim(),
      address: jobAddress.trim(),
      status: "active"
    })
    if (error) { setFormError(error.message); setSaving(false); return }
    setJobName(""); setJobAddress(""); setShowAddJob(false); setSaving(false)
    router.refresh()
  }

  async function addMember() {
    if (!memberName.trim() || !memberEmail.trim()) { setFormError("Enter name and email"); return }
    setSaving(true); setFormError("")
    const initials = memberName.trim().split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2)
    const { error } = await supabase.from("users").insert({
      company_id: userData.company_id,
      name: memberName.trim(),
      email: memberEmail.trim(),
      initials,
      role: "installer",
      is_active: true
    })
    if (error) { setFormError(error.message); setSaving(false); return }
    setMemberName(""); setMemberEmail(""); setShowAddMember(false); setSaving(false)
    router.refresh()
  }

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "approvals", label: "Approvals", badge: pendingQA.length },
    { id: "jobs", label: "Jobs" },
    { id: "team", label: "Team" },
    { id: "payroll", label: "Payroll" },
    { id: "alerts", label: "Alerts", badge: alerts.length },
  ]

  return (
    <div className="min-h-screen bg-[#0f1923] text-white">
      <div className="border-b border-white/5 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#00d4a0] flex items-center justify-center flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
              <rect x="2" y="2" width="7" height="7" rx="1.5" fill="#0f1923"/>
              <rect x="11" y="2" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.7"/>
              <rect x="2" y="11" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.7"/>
              <rect x="11" y="11" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.4"/>
            </svg>
          </div>
          <div>
            <div className="font-semibold text-sm">Van<span className="text-[#00d4a0]">tro</span></div>
            <div className="text-xs text-[#4d6478]">{companyName}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-[#00d4a0]/10 border border-[#00d4a0]/20 rounded-full px-3 py-1">
            <div className="w-1.5 h-1.5 rounded-full bg-[#00d4a0] animate-pulse"/>
            <span className="text-xs text-[#00d4a0] font-medium">{signins.length} on site</span>
          </div>
          <button onClick={handleSignOut} className="text-xs text-[#4d6478] hover:text-white transition-colors border border-white/5 rounded-full px-3 py-1">Sign out</button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3 px-6 py-4">
        {[
          { label: "On site", value: signins.length, color: "#00d4a0" },
          { label: "Jobs today", value: jobs.filter((j: any) => j.status === "active").length, color: "#f0f4f8" },
          { label: "Awaiting review", value: pendingQA.length, color: "#f59e0b" },
          { label: "Alerts", value: alerts.length, color: "#ef4444" },
        ].map(s => (
          <div key={s.label} className="bg-[#1a2635] border border-white/5 rounded-xl p-4">
            <div className="text-[#4d6478] text-xs font-medium uppercase tracking-wide mb-2">{s.label}</div>
            <div className="text-2xl font-semibold" style={{ color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-0 border-b border-white/5 px-6">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === tab.id ? "border-[#00d4a0] text-[#00d4a0]" : "border-transparent text-[#4d6478] hover:text-white"}`}>
            {tab.label}
            {tab.badge ? <span className="bg-[#00d4a0]/10 text-[#00d4a0] text-xs font-semibold px-1.5 py-0.5 rounded-full">{tab.badge}</span> : null}
          </button>
        ))}
      </div>

      <div className="px-6 py-6 max-w-6xl">

        {activeTab === "overview" && (
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-[#1a2635] border border-white/5 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
                <span className="text-sm font-medium">Live on site</span>
                <span className="text-xs bg-[#00d4a0]/10 text-[#00d4a0] px-2 py-0.5 rounded-full">{signins.length} active</span>
              </div>
              {signins.length === 0 ? (
                <div className="px-5 py-8 text-center text-[#4d6478] text-sm">No one signed in yet today</div>
              ) : signins.map((s: any) => (
                <div key={s.id} className="flex items-center gap-3 px-5 py-3 border-b border-white/5 last:border-0">
                  <div className="w-8 h-8 rounded-full bg-[#00d4a0]/10 flex items-center justify-center text-xs font-semibold text-[#00d4a0]">{s.users?.initials || "?"}</div>
                  <div className="flex-1">
                    <div className="text-sm font-medium">{s.users?.name || "Unknown"}</div>
                    <div className="text-xs text-[#4d6478]">Signed in {new Date(s.signed_in_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#00d4a0]"/>
                    <span className="text-xs text-[#00d4a0]">On site</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="bg-[#1a2635] border border-white/5 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
                <span className="text-sm font-medium">SiteLog alerts</span>
                {alerts.length > 0 && <span className="text-xs bg-red-400/10 text-red-400 px-2 py-0.5 rounded-full">{alerts.length} unread</span>}
              </div>
              {alerts.length === 0 ? (
                <div className="px-5 py-8 text-center text-[#4d6478] text-sm">No alerts — all clear</div>
              ) : alerts.slice(0, 5).map((a: any) => (
                <div key={a.id} className="px-5 py-3 border-b border-white/5 last:border-0">
                  <div className="flex items-start gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${a.alert_type === "blocker" ? "bg-red-400" : "bg-yellow-400"}`}/>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-[#4d6478] mb-0.5">{a.jobs?.name}</div>
                      <div className="text-sm">{a.message}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="bg-[#1a2635] border border-white/5 rounded-xl overflow-hidden col-span-2">
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
                <span className="text-sm font-medium">Active jobs</span>
                <span className="text-xs text-[#4d6478]">{jobs.length} total</span>
              </div>
              {jobs.length === 0 ? (
                <div className="px-5 py-8 text-center text-[#4d6478] text-sm">No jobs yet — add one in the Jobs tab</div>
              ) : jobs.slice(0, 5).map((j: any) => (
                <div key={j.id} className="flex items-center gap-4 px-5 py-3 border-b border-white/5 last:border-0">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{j.name}</div>
                    <div className="text-xs text-[#4d6478] truncate">{j.address}</div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${j.status === "active" ? "bg-[#00d4a0]/10 text-[#00d4a0]" : "bg-white/5 text-[#4d6478]"}`}>{j.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "approvals" && (
          <div className="bg-[#1a2635] border border-white/5 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/5"><span className="text-sm font-medium">QA approval queue</span></div>
            {pendingQA.length === 0 ? (
              <div className="px-5 py-12 text-center text-[#4d6478] text-sm">Nothing waiting for approval</div>
            ) : pendingQA.map((qa: any) => (
              <div key={qa.id} className="px-5 py-4 border-b border-white/5 last:border-0">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-6 h-6 rounded-full bg-[#00d4a0]/10 flex items-center justify-center text-xs font-semibold text-[#00d4a0]">{qa.users?.initials || "?"}</div>
                      <span className="text-sm font-medium">{qa.users?.name}</span>
                      <span className="text-xs text-[#4d6478]">on {qa.jobs?.name}</span>
                    </div>
                    {qa.notes && <div className="text-xs text-[#4d6478]">Note: {qa.notes}</div>}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button onClick={() => approveQA(qa.id)} className="bg-[#00d4a0]/10 hover:bg-[#00d4a0]/20 text-[#00d4a0] border border-[#00d4a0]/20 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors">Approve</button>
                    <button onClick={() => { const note = window.prompt("Rejection reason:"); if (note) rejectQA(qa.id, note) }} className="bg-red-400/10 hover:bg-red-400/20 text-red-400 border border-red-400/20 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors">Reject</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === "jobs" && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <button onClick={() => { setShowAddJob(true); setFormError("") }} className="bg-[#00d4a0] hover:bg-[#00a87e] text-[#0f1923] font-semibold rounded-xl px-4 py-2 text-sm transition-colors">+ Add job</button>
            </div>
            {showAddJob && (
              <div className="bg-[#1a2635] border border-[#00d4a0]/20 rounded-xl p-5 space-y-3">
                <h3 className="text-sm font-semibold">New job</h3>
                <input value={jobName} onChange={e => setJobName(e.target.value)} placeholder="Job name" className="w-full bg-[#243040] border border-white/5 rounded-xl px-4 py-2.5 text-white placeholder-[#4d6478] focus:outline-none focus:border-[#00d4a0]/40 text-sm"/>
                <input value={jobAddress} onChange={e => setJobAddress(e.target.value)} placeholder="Site address" className="w-full bg-[#243040] border border-white/5 rounded-xl px-4 py-2.5 text-white placeholder-[#4d6478] focus:outline-none focus:border-[#00d4a0]/40 text-sm"/>
                {formError && <p className="text-xs text-red-400">{formError}</p>}
                <div className="flex gap-2">
                  <button onClick={addJob} disabled={saving} className="bg-[#00d4a0] hover:bg-[#00a87e] disabled:opacity-50 text-[#0f1923] font-semibold rounded-xl px-4 py-2 text-sm transition-colors">{saving ? "Saving..." : "Save job"}</button>
                  <button onClick={() => setShowAddJob(false)} className="bg-[#243040] text-[#8fa3b8] rounded-xl px-4 py-2 text-sm">Cancel</button>
                </div>
              </div>
            )}
            <div className="bg-[#1a2635] border border-white/5 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-white/5"><span className="text-sm font-medium">All jobs</span></div>
              {jobs.length === 0 ? (
                <div className="px-5 py-12 text-center text-[#4d6478] text-sm">No jobs yet</div>
              ) : jobs.map((j: any) => (
                <div key={j.id} className="flex items-center gap-4 px-5 py-4 border-b border-white/5 last:border-0">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{j.name}</div>
                    <div className="text-xs text-[#4d6478]">{j.address}</div>
                    <div className="text-xs text-[#4d6478] mt-0.5">Created {new Date(j.created_at).toLocaleDateString("en-GB")}</div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${j.status === "active" ? "bg-[#00d4a0]/10 text-[#00d4a0]" : "bg-white/5 text-[#4d6478]"}`}>{j.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "team" && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <button onClick={() => { setShowAddMember(true); setFormError("") }} className="bg-[#00d4a0] hover:bg-[#00a87e] text-[#0f1923] font-semibold rounded-xl px-4 py-2 text-sm transition-colors">+ Add member</button>
            </div>
            {showAddMember && (
              <div className="bg-[#1a2635] border border-[#00d4a0]/20 rounded-xl p-5 space-y-3">
                <h3 className="text-sm font-semibold">New team member</h3>
                <input value={memberName} onChange={e => setMemberName(e.target.value)} placeholder="Full name" className="w-full bg-[#243040] border border-white/5 rounded-xl px-4 py-2.5 text-white placeholder-[#4d6478] focus:outline-none focus:border-[#00d4a0]/40 text-sm"/>
                <input value={memberEmail} onChange={e => setMemberEmail(e.target.value)} placeholder="Email address" type="email" className="w-full bg-[#243040] border border-white/5 rounded-xl px-4 py-2.5 text-white placeholder-[#4d6478] focus:outline-none focus:border-[#00d4a0]/40 text-sm"/>
                {formError && <p className="text-xs text-red-400">{formError}</p>}
                <div className="flex gap-2">
                  <button onClick={addMember} disabled={saving} className="bg-[#00d4a0] hover:bg-[#00a87e] disabled:opacity-50 text-[#0f1923] font-semibold rounded-xl px-4 py-2 text-sm transition-colors">{saving ? "Saving..." : "Save member"}</button>
                  <button onClick={() => setShowAddMember(false)} className="bg-[#243040] text-[#8fa3b8] rounded-xl px-4 py-2 text-sm">Cancel</button>
                </div>
              </div>
            )}
            <div className="bg-[#1a2635] border border-white/5 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-white/5"><span className="text-sm font-medium">Team members</span></div>
              {teamMembers.length === 0 ? (
                <div className="px-5 py-12 text-center text-[#4d6478] text-sm">No team members yet</div>
              ) : teamMembers.map((m: any) => (
                <div key={m.id} className="flex items-center gap-3 px-5 py-3 border-b border-white/5 last:border-0">
                  <div className="w-9 h-9 rounded-full bg-[#243040] flex items-center justify-center text-sm font-semibold">{m.initials}</div>
                  <div className="flex-1">
                    <div className="text-sm font-medium">{m.name}</div>
                    <div className="text-xs text-[#4d6478]">{m.email || "No email"}</div>
                  </div>
                  <span className="text-xs bg-white/5 text-[#8fa3b8] px-2 py-0.5 rounded-full capitalize">{m.role}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "payroll" && (
          <div className="space-y-4">
            <div className="bg-[#1a2635] border border-white/5 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-white/5">
                <span className="text-sm font-medium">Hours this week — by installer</span>
              </div>
              {teamMembers.filter((m: any) => m.role === "installer").length === 0 ? (
                <div className="px-5 py-12 text-center text-[#4d6478] text-sm">No installers on your team yet</div>
              ) : teamMembers.filter((m: any) => m.role === "installer").map((m: any) => {
                const memberSignins = signins.filter((s: any) => s.users?.id === m.id || s.user_id === m.id)
                const hoursToday = memberSignins.reduce((acc: number, s: any) => {
                  if (s.signed_in_at && s.signed_out_at) {
                    const diff = new Date(s.signed_out_at).getTime() - new Date(s.signed_in_at).getTime()
                    return acc + diff / 3600000
                  }
                  return acc
                }, 0)
                return (
                  <div key={m.id} className="flex items-center gap-4 px-5 py-4 border-b border-white/5 last:border-0">
                    <div className="w-9 h-9 rounded-full bg-[#243040] flex items-center justify-center text-sm font-semibold flex-shrink-0">{m.initials}</div>
                    <div className="flex-1">
                      <div className="text-sm font-medium">{m.name}</div>
                      <div className="text-xs text-[#4d6478]">{m.email}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-[#00d4a0]">{hoursToday.toFixed(1)}h</div>
                      <div className="text-xs text-[#4d6478]">today</div>
                    </div>
                  </div>
                )
              })}
            </div>
            <p className="text-xs text-[#4d6478] px-1">Full weekly payroll report — coming in next build. Currently showing today only from live sign-in data.</p>
          </div>
        )}

        {activeTab === "alerts" && (
          <div className="bg-[#1a2635] border border-white/5 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/5"><span className="text-sm font-medium">SiteLog alerts</span></div>
            {alerts.length === 0 ? (
              <div className="px-5 py-12 text-center text-[#4d6478] text-sm">No alerts — all clear</div>
            ) : alerts.map((a: any) => (
              <div key={a.id} className="px-5 py-4 border-b border-white/5 last:border-0">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${a.alert_type === "blocker" ? "bg-red-400" : a.alert_type === "issue" ? "bg-yellow-400" : "bg-blue-400"}`}/>
                    <div>
                      <div className="text-xs text-[#4d6478] mb-1">{a.jobs?.name} · {new Date(a.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</div>
                      <div className="text-sm">{a.message}</div>
                    </div>
                  </div>
                  <button onClick={() => markAlertRead(a.id)} className="text-xs text-[#4d6478] hover:text-white transition-colors flex-shrink-0">Dismiss</button>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  )
}
