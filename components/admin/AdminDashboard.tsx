"use client"
import { useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"

interface Props {
  user: any; userData: any; jobs: any[]; signins: any[]; alerts: any[]; pendingQA: any[]; teamMembers: any[]; jobAssignments: any[]
}

export default function AdminDashboard({ user, userData, jobs, signins, alerts, pendingQA, teamMembers, jobAssignments }: Props) {
  const [activeTab, setActiveTab] = useState("overview")
  const [showAddJob, setShowAddJob] = useState(false)
  const [showAddMember, setShowAddMember] = useState(false)
  const [assigningJobId, setAssigningJobId] = useState<string|null>(null)
  const [jobName, setJobName] = useState("")
  const [jobAddress, setJobAddress] = useState("")
  const [memberName, setMemberName] = useState("")
  const [memberEmail, setMemberEmail] = useState("")
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState("")
  const router = useRouter()
  const supabase = createClient()

  async function handleSignOut() { await supabase.auth.signOut(); router.push("/login") }
  async function approveQA(id: string) { await supabase.from("qa_submissions").update({ state: "approved", reviewed_at: new Date().toISOString() }).eq("id", id); router.refresh() }
  async function rejectQA(id: string, note: string) { await supabase.from("qa_submissions").update({ state: "rejected", rejection_note: note, reviewed_at: new Date().toISOString() }).eq("id", id); router.refresh() }
  async function markAlertRead(id: string) { await supabase.from("alerts").update({ is_read: true }).eq("id", id); router.refresh() }

  async function addJob() {
    if (!jobName.trim() || !jobAddress.trim()) { setFormError("Enter job name and address"); return }
    setSaving(true); setFormError("")
    const { error } = await supabase.from("jobs").insert({ company_id: userData.company_id, name: jobName.trim(), address: jobAddress.trim(), status: "active" })
    if (error) { setFormError(error.message); setSaving(false); return }
    setJobName(""); setJobAddress(""); setShowAddJob(false); setSaving(false); router.refresh()
  }

  async function addMember() {
    if (!memberName.trim() || !memberEmail.trim()) { setFormError("Enter name and email"); return }
    setSaving(true); setFormError("")
    const initials = memberName.trim().split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2)
    const { error } = await supabase.from("users").insert({ company_id: userData.company_id, name: memberName.trim(), email: memberEmail.trim(), initials, role: "installer", is_active: true })
    if (error) { setFormError(error.message); setSaving(false); return }
    setMemberName(""); setMemberEmail(""); setShowAddMember(false); setSaving(false); router.refresh()
  }

  async function toggleAssignment(jobId: string, userId: string) {
    const existing = jobAssignments.find((a: any) => a.job_id === jobId && a.user_id === userId)
    if (existing) {
      await supabase.from("job_assignments").delete().eq("id", existing.id)
    } else {
      await supabase.from("job_assignments").insert({ job_id: jobId, user_id: userId, company_id: userData.company_id })
    }
    router.refresh()
  }

  const installers = teamMembers.filter((m: any) => m.role === "installer")
  const getAssignedInstallers = (jobId: string) => {
    const assignedIds = jobAssignments.filter((a: any) => a.job_id === jobId).map((a: any) => a.user_id)
    return teamMembers.filter((m: any) => assignedIds.includes(m.id))
  }

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "approvals", label: "Approvals", badge: pendingQA.length },
    { id: "jobs", label: "Jobs" },
    { id: "team", label: "Team" },
    { id: "payroll", label: "Payroll" },
    { id: "alerts", label: "Alerts", badge: alerts.length },
  ]

  const inp = "w-full bg-[#111827] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-[#4d6478] focus:outline-none focus:border-[#00d4a0]/60 text-base"

  return (
    <div className="min-h-screen bg-[#111827] text-white">

      <div className="bg-[#1f2937] border-b border-white/8 px-8 py-5 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-[#00d4a0] flex items-center justify-center flex-shrink-0">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
              <rect x="2" y="2" width="7" height="7" rx="1.5" fill="#111827"/>
              <rect x="11" y="2" width="7" height="7" rx="1.5" fill="#111827" opacity="0.7"/>
              <rect x="2" y="11" width="7" height="7" rx="1.5" fill="#111827" opacity="0.7"/>
              <rect x="11" y="11" width="7" height="7" rx="1.5" fill="#111827" opacity="0.4"/>
            </svg>
          </div>
          <div>
            <div className="font-bold text-lg">Van<span className="text-[#00d4a0]">tro</span></div>
            <div className="text-sm text-gray-400">{userData?.company_name || "Dashboard"}</div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-[#00d4a0]/10 border border-[#00d4a0]/20 rounded-full px-4 py-2">
            <div className="w-2 h-2 rounded-full bg-[#00d4a0] animate-pulse"/>
            <span className="text-sm text-[#00d4a0] font-semibold">{signins.length} on site</span>
          </div>
          <button onClick={handleSignOut} className="text-sm text-gray-400 hover:text-white transition-colors border border-white/10 rounded-full px-4 py-2">Sign out</button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 px-8 py-6">
        {[
          { label: "On Site Now", value: signins.length, color: "#00d4a0" },
          { label: "Active Jobs", value: jobs.filter((j: any) => j.status === "active").length, color: "#ffffff" },
          { label: "Awaiting Approval", value: pendingQA.length, color: "#f59e0b" },
          { label: "Unread Alerts", value: alerts.length, color: "#ef4444" },
        ].map(s => (
          <div key={s.label} className="bg-[#1f2937] border border-white/8 rounded-2xl p-6">
            <div className="text-gray-400 text-sm font-medium mb-3">{s.label}</div>
            <div className="text-4xl font-bold" style={{ color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="flex border-b border-white/8 px-8">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-5 py-4 text-base font-medium border-b-2 transition-colors ${activeTab === tab.id ? "border-[#00d4a0] text-white" : "border-transparent text-gray-400 hover:text-white"}`}>
            {tab.label}
            {tab.badge ? <span className="bg-[#00d4a0]/15 text-[#00d4a0] text-xs font-bold px-2 py-0.5 rounded-full">{tab.badge}</span> : null}
          </button>
        ))}
      </div>

      <div className="px-8 py-8 max-w-6xl">

        {activeTab === "overview" && (
          <div className="grid grid-cols-2 gap-6">
            <div className="bg-[#1f2937] border border-white/8 rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-6 py-5 border-b border-white/8">
                <span className="text-base font-semibold">Live on site</span>
                <span className="text-sm bg-[#00d4a0]/10 text-[#00d4a0] px-3 py-1 rounded-full font-medium">{signins.length} active</span>
              </div>
              {signins.length === 0 ? <div className="px-6 py-10 text-center text-gray-400">No one signed in yet today</div>
              : signins.map((s: any) => (
                <div key={s.id} className="flex items-center gap-4 px-6 py-4 border-b border-white/5 last:border-0">
                  <div className="w-10 h-10 rounded-full bg-[#00d4a0]/15 flex items-center justify-center text-sm font-bold text-[#00d4a0]">{s.users?.initials || "?"}</div>
                  <div className="flex-1">
                    <div className="text-base font-medium">{s.users?.name || "Unknown"}</div>
                    <div className="text-sm text-gray-400">In at {new Date(s.signed_in_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</div>
                  </div>
                  <span className="text-sm text-[#00d4a0] font-medium">? On site</span>
                </div>
              ))}
            </div>
            <div className="bg-[#1f2937] border border-white/8 rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-6 py-5 border-b border-white/8">
                <span className="text-base font-semibold">Alerts</span>
                {alerts.length > 0 && <span className="text-sm bg-red-400/10 text-red-400 px-3 py-1 rounded-full font-medium">{alerts.length} unread</span>}
              </div>
              {alerts.length === 0 ? <div className="px-6 py-10 text-center text-gray-400">No alerts � all clear</div>
              : alerts.slice(0, 5).map((a: any) => (
                <div key={a.id} className="px-6 py-4 border-b border-white/5 last:border-0">
                  <div className="text-sm text-gray-400 mb-1">{a.jobs?.name}</div>
                  <div className="text-base">{a.message}</div>
                </div>
              ))}
            </div>
            <div className="bg-[#1f2937] border border-white/8 rounded-2xl overflow-hidden col-span-2">
              <div className="flex items-center justify-between px-6 py-5 border-b border-white/8">
                <span className="text-base font-semibold">Active jobs</span>
                <span className="text-sm text-gray-400">{jobs.length} total</span>
              </div>
              {jobs.length === 0 ? <div className="px-6 py-10 text-center text-gray-400">No jobs yet</div>
              : jobs.slice(0, 6).map((j: any) => {
                const assigned = getAssignedInstallers(j.id)
                return (
                  <div key={j.id} className="flex items-center gap-4 px-6 py-4 border-b border-white/5 last:border-0">
                    <div className="flex-1">
                      <div className="text-base font-medium">{j.name}</div>
                      <div className="text-sm text-gray-400">{j.address}</div>
                    </div>
                    {assigned.length > 0 && (
                      <div className="flex items-center gap-1">
                        {assigned.map((a: any) => (
                          <div key={a.id} className="w-7 h-7 rounded-full bg-[#374151] flex items-center justify-center text-xs font-bold">{a.initials}</div>
                        ))}
                      </div>
                    )}
                    <span className={`text-sm px-3 py-1 rounded-full font-medium ${j.status === "active" ? "bg-[#00d4a0]/10 text-[#00d4a0]" : "bg-white/5 text-gray-400"}`}>{j.status}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {activeTab === "approvals" && (
          <div className="bg-[#1f2937] border border-white/8 rounded-2xl overflow-hidden">
            <div className="px-6 py-5 border-b border-white/8"><span className="text-base font-semibold">QA approval queue</span></div>
            {pendingQA.length === 0 ? <div className="px-6 py-16 text-center text-gray-400">Nothing waiting for approval</div>
            : pendingQA.map((qa: any) => (
              <div key={qa.id} className="px-6 py-5 border-b border-white/5 last:border-0">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <div className="w-8 h-8 rounded-full bg-[#00d4a0]/15 flex items-center justify-center text-sm font-bold text-[#00d4a0]">{qa.users?.initials || "?"}</div>
                      <span className="text-base font-medium">{qa.users?.name}</span>
                      <span className="text-sm text-gray-400">on {qa.jobs?.name}</span>
                    </div>
                    {qa.notes && <div className="text-sm text-gray-400 mt-1">Note: {qa.notes}</div>}
                  </div>
                  <div className="flex gap-3 flex-shrink-0">
                    <button onClick={() => approveQA(qa.id)} className="bg-[#00d4a0]/10 hover:bg-[#00d4a0]/20 text-[#00d4a0] border border-[#00d4a0]/20 rounded-xl px-4 py-2 text-sm font-semibold">Approve</button>
                    <button onClick={() => { const note = window.prompt("Rejection reason:"); if (note) rejectQA(qa.id, note) }} className="bg-red-400/10 hover:bg-red-400/20 text-red-400 border border-red-400/20 rounded-xl px-4 py-2 text-sm font-semibold">Reject</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === "jobs" && (
          <div className="space-y-5">
            <div className="flex justify-end">
              <button onClick={() => { setShowAddJob(true); setFormError("") }} className="bg-[#00d4a0] hover:bg-[#00a87e] text-[#111827] font-bold rounded-xl px-5 py-3 text-sm transition-colors">+ Add job</button>
            </div>
            {showAddJob && (
              <div className="bg-[#1f2937] border border-[#00d4a0]/30 rounded-2xl p-6 space-y-4">
                <h3 className="text-base font-semibold">New job</h3>
                <input value={jobName} onChange={e => setJobName(e.target.value)} placeholder="Job name e.g. Riverside Office Fit-out" className={inp}/>
                <input value={jobAddress} onChange={e => setJobAddress(e.target.value)} placeholder="Site address" className={inp}/>
                {formError && <p className="text-sm text-red-400">{formError}</p>}
                <div className="flex gap-3">
                  <button onClick={addJob} disabled={saving} className="bg-[#00d4a0] hover:bg-[#00a87e] disabled:opacity-50 text-[#111827] font-bold rounded-xl px-5 py-3 text-sm">{saving ? "Saving..." : "Save job"}</button>
                  <button onClick={() => setShowAddJob(false)} className="bg-white/5 text-gray-400 rounded-xl px-5 py-3 text-sm">Cancel</button>
                </div>
              </div>
            )}
            <div className="bg-[#1f2937] border border-white/8 rounded-2xl overflow-hidden">
              <div className="px-6 py-5 border-b border-white/8"><span className="text-base font-semibold">All jobs</span></div>
              {jobs.length === 0 ? <div className="px-6 py-16 text-center text-gray-400">No jobs yet</div>
              : jobs.map((j: any) => {
                const assigned = getAssignedInstallers(j.id)
                const isAssigning = assigningJobId === j.id
                return (
                  <div key={j.id} className="border-b border-white/5 last:border-0">
                    <div className="flex items-center gap-4 px-6 py-5">
                      <div className="flex-1">
                        <div className="text-base font-semibold">{j.name}</div>
                        <div className="text-sm text-gray-400 mt-0.5">{j.address}</div>
                        {assigned.length > 0 && (
                          <div className="flex items-center gap-2 mt-2">
                            {assigned.map((a: any) => (
                              <span key={a.id} className="text-xs bg-[#374151] text-gray-400 px-2 py-1 rounded-lg font-medium">{a.name}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      <button onClick={() => setAssigningJobId(isAssigning ? null : j.id)}
                        className="text-sm border border-white/10 text-gray-400 hover:text-white hover:border-white/20 rounded-xl px-4 py-2 transition-colors flex-shrink-0">
                        {isAssigning ? "Done" : "Assign installers"}
                      </button>
                      <span className={`text-sm px-3 py-1 rounded-full font-medium flex-shrink-0 ${j.status === "active" ? "bg-[#00d4a0]/10 text-[#00d4a0]" : "bg-white/5 text-gray-400"}`}>{j.status}</span>
                    </div>
                    {isAssigning && (
                      <div className="px-6 pb-5">
                        <div className="bg-[#111827] border border-white/8 rounded-xl p-4">
                          <p className="text-sm text-gray-400 mb-3">Tap to assign / unassign</p>
                          {installers.length === 0 ? (
                            <p className="text-sm text-[#4d6478]">No installers on your team yet � add them in the Team tab</p>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              {installers.map((m: any) => {
                                const isAssigned = jobAssignments.some((a: any) => a.job_id === j.id && a.user_id === m.id)
                                return (
                                  <button key={m.id} onClick={() => toggleAssignment(j.id, m.id)}
                                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${isAssigned ? "bg-[#00d4a0]/15 text-[#00d4a0] border border-[#00d4a0]/30" : "bg-[#374151] text-gray-400 border border-white/8 hover:border-white/20"}`}>
                                    <div className="w-6 h-6 rounded-full bg-current/20 flex items-center justify-center text-xs font-bold">{m.initials}</div>
                                    {m.name}
                                    {isAssigned && <span className="text-xs">?</span>}
                                  </button>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {activeTab === "team" && (
          <div className="space-y-5">
            <div className="flex justify-end">
              <button onClick={() => { setShowAddMember(true); setFormError("") }} className="bg-[#00d4a0] hover:bg-[#00a87e] text-[#111827] font-bold rounded-xl px-5 py-3 text-sm transition-colors">+ Add member</button>
            </div>
            {showAddMember && (
              <div className="bg-[#1f2937] border border-[#00d4a0]/30 rounded-2xl p-6 space-y-4">
                <h3 className="text-base font-semibold">New team member</h3>
                <input value={memberName} onChange={e => setMemberName(e.target.value)} placeholder="Full name" className={inp}/>
                <input value={memberEmail} onChange={e => setMemberEmail(e.target.value)} placeholder="Email address" type="email" className={inp}/>
                {formError && <p className="text-sm text-red-400">{formError}</p>}
                <div className="flex gap-3">
                  <button onClick={addMember} disabled={saving} className="bg-[#00d4a0] hover:bg-[#00a87e] disabled:opacity-50 text-[#111827] font-bold rounded-xl px-5 py-3 text-sm">{saving ? "Saving..." : "Save member"}</button>
                  <button onClick={() => setShowAddMember(false)} className="bg-white/5 text-gray-400 rounded-xl px-5 py-3 text-sm">Cancel</button>
                </div>
              </div>
            )}
            <div className="bg-[#1f2937] border border-white/8 rounded-2xl overflow-hidden">
              <div className="px-6 py-5 border-b border-white/8"><span className="text-base font-semibold">Team members</span></div>
              {teamMembers.length === 0 ? <div className="px-6 py-16 text-center text-gray-400">No team members yet</div>
              : teamMembers.map((m: any) => (
                <div key={m.id} className="flex items-center gap-4 px-6 py-5 border-b border-white/5 last:border-0">
                  <div className="w-11 h-11 rounded-full bg-[#374151] flex items-center justify-center text-base font-bold flex-shrink-0">{m.initials}</div>
                  <div className="flex-1">
                    <div className="text-base font-semibold">{m.name}</div>
                    <div className="text-sm text-gray-400 mt-0.5">{m.email || "No email"}</div>
                  </div>
                  <span className="text-sm bg-white/5 text-gray-400 px-3 py-1 rounded-full capitalize font-medium">{m.role}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "payroll" && (
          <div className="space-y-5">
            <div className="bg-[#1f2937] border border-white/8 rounded-2xl overflow-hidden">
              <div className="px-6 py-5 border-b border-white/8"><span className="text-base font-semibold">Hours today � by installer</span></div>
              {installers.length === 0 ? <div className="px-6 py-16 text-center text-gray-400">No installers on your team yet</div>
              : installers.map((m: any) => {
                const ms = signins.filter((s: any) => s.user_id === m.id)
                const hrs = ms.reduce((acc: number, s: any) => {
                  if (s.signed_in_at && s.signed_out_at) return acc + (new Date(s.signed_out_at).getTime() - new Date(s.signed_in_at).getTime()) / 3600000
                  return acc
                }, 0)
                return (
                  <div key={m.id} className="flex items-center gap-4 px-6 py-5 border-b border-white/5 last:border-0">
                    <div className="w-11 h-11 rounded-full bg-[#374151] flex items-center justify-center text-base font-bold flex-shrink-0">{m.initials}</div>
                    <div className="flex-1">
                      <div className="text-base font-semibold">{m.name}</div>
                      <div className="text-sm text-gray-400">{m.email}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-[#00d4a0]">{hrs.toFixed(1)}h</div>
                      <div className="text-sm text-gray-400">today</div>
                    </div>
                  </div>
                )
              })}
            </div>
            <p className="text-sm text-[#4d6478] px-1">Full weekly payroll coming in next build.</p>
          </div>
        )}

        {activeTab === "alerts" && (
          <div className="bg-[#1f2937] border border-white/8 rounded-2xl overflow-hidden">
            <div className="px-6 py-5 border-b border-white/8"><span className="text-base font-semibold">SiteLog alerts</span></div>
            {alerts.length === 0 ? <div className="px-6 py-16 text-center text-gray-400">No alerts � all clear</div>
            : alerts.map((a: any) => (
              <div key={a.id} className="px-6 py-5 border-b border-white/5 last:border-0">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm text-gray-400 mb-1">{a.jobs?.name} � {new Date(a.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</div>
                    <div className="text-base">{a.message}</div>
                  </div>
                  <button onClick={() => markAlertRead(a.id)} className="text-sm text-gray-400 hover:text-white transition-colors flex-shrink-0 border border-white/10 rounded-lg px-3 py-2">Dismiss</button>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  )
}
