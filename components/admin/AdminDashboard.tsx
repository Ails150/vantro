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
    setMemberName(""); setMemberEmail(""); setShowAddMember(false); setSaving(false); window.location.reload()
  }

  async function toggleAssignment(jobId: string, userId: string) {
    const existing = jobAssignments.find((a: any) => a.job_id === jobId && a.user_id === userId)
    if (existing) { await supabase.from("job_assignments").delete().eq("id", existing.id) }
    else { await supabase.from("job_assignments").insert({ job_id: jobId, user_id: userId, company_id: userData.company_id }) }
    router.refresh()
  }

  const installers = teamMembers.filter((m: any) => m.role === "installer")
  const getAssigned = (jobId: string) => {
    const ids = jobAssignments.filter((a: any) => a.job_id === jobId).map((a: any) => a.user_id)
    return teamMembers.filter((m: any) => ids.includes(m.id))
  }

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "approvals", label: "Approvals", badge: pendingQA.length },
    { id: "jobs", label: "Jobs" },
    { id: "team", label: "Team" },
    { id: "payroll", label: "Payroll" },
    { id: "alerts", label: "Alerts", badge: alerts.length },
  ]

  const inp = "w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-gray-900 placeholder-gray-400 focus:outline-none focus:border-teal-400 text-base"
  const card = "bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm"
  const cardHeader = "flex items-center justify-between px-6 py-4 border-b border-gray-100"
  const subtext = "text-gray-500"

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">

      <div className="bg-white border-b border-gray-200 px-8 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-teal-400 flex items-center justify-center flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
              <rect x="2" y="2" width="7" height="7" rx="1.5" fill="white"/>
              <rect x="11" y="2" width="7" height="7" rx="1.5" fill="white" opacity="0.7"/>
              <rect x="2" y="11" width="7" height="7" rx="1.5" fill="white" opacity="0.7"/>
              <rect x="11" y="11" width="7" height="7" rx="1.5" fill="white" opacity="0.4"/>
            </svg>
          </div>
          <div>
            <div className="font-bold text-base">Van<span className="text-teal-500">tro</span></div>
            <div className="text-xs text-gray-500">Field Operations</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-teal-50 border border-teal-200 rounded-full px-4 py-1.5">
            <div className="w-2 h-2 rounded-full bg-teal-400 animate-pulse"/>
            <span className="text-sm text-teal-700 font-semibold">{signins.length} on site</span>
          </div>
          <button onClick={handleSignOut} className="text-sm text-gray-500 hover:text-gray-900 transition-colors border border-gray-200 rounded-full px-4 py-1.5">Sign out</button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 px-8 py-6">
        {[
          { label: "On Site Now", value: signins.length, color: "text-teal-500" },
          { label: "Active Jobs", value: jobs.filter((j: any) => j.status === "active").length, color: "text-gray-900" },
          { label: "Awaiting Approval", value: pendingQA.length, color: "text-amber-500" },
          { label: "Unread Alerts", value: alerts.length, color: "text-red-500" },
        ].map(s => (
          <div key={s.label} className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
            <div className="text-gray-500 text-sm font-medium mb-2">{s.label}</div>
            <div className={`text-4xl font-bold ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="flex border-b border-gray-200 px-8 bg-white">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-5 py-4 text-sm font-semibold border-b-2 transition-colors ${activeTab === tab.id ? "border-teal-400 text-teal-600" : "border-transparent text-gray-500 hover:text-gray-900"}`}>
            {tab.label}
            {tab.badge ? <span className="bg-teal-50 text-teal-600 text-xs font-bold px-2 py-0.5 rounded-full">{tab.badge}</span> : null}
          </button>
        ))}
      </div>

      <div className="px-8 py-6 max-w-6xl">

        {activeTab === "overview" && (
          <div className="grid grid-cols-2 gap-5">
            <div className={card}>
              <div className={cardHeader}>
                <span className="font-semibold">Live on site</span>
                <span className="text-sm bg-teal-50 text-teal-600 px-3 py-1 rounded-full font-medium">{signins.length} active</span>
              </div>
              {signins.length === 0 ? <div className={`px-6 py-10 text-center ${subtext}`}>No one signed in yet today</div>
              : signins.map((s: any) => (
                <div key={s.id} className="flex items-center gap-4 px-6 py-4 border-b border-gray-50 last:border-0">
                  <div className="w-10 h-10 rounded-full bg-teal-50 flex items-center justify-center text-sm font-bold text-teal-600">{s.users?.initials || "?"}</div>
                  <div className="flex-1">
                    <div className="font-semibold">{s.users?.name || "Unknown"}</div>
                    <div className={`text-sm ${subtext}`}>In at {new Date(s.signed_in_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</div>
                  </div>
                  <span className="text-sm text-teal-500 font-medium">On site</span>
                </div>
              ))}
            </div>
            <div className={card}>
              <div className={cardHeader}>
                <span className="font-semibold">Alerts</span>
                {alerts.length > 0 && <span className="text-sm bg-red-50 text-red-500 px-3 py-1 rounded-full font-medium">{alerts.length} unread</span>}
              </div>
              {alerts.length === 0 ? <div className={`px-6 py-10 text-center ${subtext}`}>No alerts - all clear</div>
              : alerts.slice(0, 5).map((a: any) => (
                <div key={a.id} className="px-6 py-4 border-b border-gray-50 last:border-0">
                  <div className={`text-sm ${subtext} mb-1`}>{a.jobs?.name}</div>
                  <div>{a.message}</div>
                </div>
              ))}
            </div>
            <div className={`${card} col-span-2`}>
              <div className={cardHeader}>
                <span className="font-semibold">Active jobs</span>
                <span className={`text-sm ${subtext}`}>{jobs.length} total</span>
              </div>
              {jobs.length === 0 ? <div className={`px-6 py-10 text-center ${subtext}`}>No jobs yet</div>
              : jobs.slice(0, 6).map((j: any) => {
                const assigned = getAssigned(j.id)
                return (
                  <div key={j.id} className="flex items-center gap-4 px-6 py-4 border-b border-gray-50 last:border-0">
                    <div className="flex-1">
                      <div className="font-semibold">{j.name}</div>
                      <div className={`text-sm ${subtext}`}>{j.address}</div>
                    </div>
                    {assigned.length > 0 && (
                      <div className="flex gap-1">
                        {assigned.map((a: any) => (
                          <div key={a.id} className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold">{a.initials}</div>
                        ))}
                      </div>
                    )}
                    <span className={`text-sm px-3 py-1 rounded-full font-medium ${j.status === "active" ? "bg-teal-50 text-teal-600" : "bg-gray-100 text-gray-500"}`}>{j.status}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {activeTab === "approvals" && (
          <div className={card}>
            <div className={cardHeader}><span className="font-semibold">QA approval queue</span></div>
            {pendingQA.length === 0 ? <div className={`px-6 py-16 text-center ${subtext}`}>Nothing waiting for approval</div>
            : pendingQA.map((qa: any) => (
              <div key={qa.id} className="px-6 py-5 border-b border-gray-50 last:border-0">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <div className="w-8 h-8 rounded-full bg-teal-50 flex items-center justify-center text-sm font-bold text-teal-600">{qa.users?.initials || "?"}</div>
                      <span className="font-semibold">{qa.users?.name}</span>
                      <span className={`text-sm ${subtext}`}>on {qa.jobs?.name}</span>
                    </div>
                    {qa.notes && <div className={`text-sm ${subtext}`}>Note: {qa.notes}</div>}
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => approveQA(qa.id)} className="bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 rounded-xl px-4 py-2 text-sm font-semibold">Approve</button>
                    <button onClick={() => { const note = window.prompt("Rejection reason:"); if (note) rejectQA(qa.id, note) }} className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded-xl px-4 py-2 text-sm font-semibold">Reject</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === "jobs" && (
          <div className="space-y-5">
            <div className="flex justify-end">
              <button onClick={() => { setShowAddJob(true); setFormError("") }} className="bg-teal-400 hover:bg-teal-500 text-white font-bold rounded-xl px-5 py-2.5 text-sm transition-colors">+ Add job</button>
            </div>
            {showAddJob && (
              <div className="bg-white border border-teal-200 rounded-2xl p-6 space-y-4 shadow-sm">
                <h3 className="font-semibold">New job</h3>
                <input value={jobName} onChange={e => setJobName(e.target.value)} placeholder="Job name" className={inp}/>
                <input value={jobAddress} onChange={e => setJobAddress(e.target.value)} placeholder="Site address" className={inp}/>
                {formError && <p className="text-sm text-red-500">{formError}</p>}
                <div className="flex gap-3">
                  <button onClick={addJob} disabled={saving} className="bg-teal-400 hover:bg-teal-500 disabled:opacity-50 text-white font-bold rounded-xl px-5 py-2.5 text-sm">{saving ? "Saving..." : "Save job"}</button>
                  <button onClick={() => setShowAddJob(false)} className="bg-gray-100 text-gray-600 rounded-xl px-5 py-2.5 text-sm">Cancel</button>
                </div>
              </div>
            )}
            <div className={card}>
              <div className={cardHeader}><span className="font-semibold">All jobs</span></div>
              {jobs.length === 0 ? <div className={`px-6 py-16 text-center ${subtext}`}>No jobs yet</div>
              : jobs.map((j: any) => {
                const assigned = getAssigned(j.id)
                const isAssigning = assigningJobId === j.id
                return (
                  <div key={j.id} className="border-b border-gray-50 last:border-0">
                    <div className="flex items-center gap-4 px-6 py-5">
                      <div className="flex-1">
                        <div className="font-semibold">{j.name}</div>
                        <div className={`text-sm ${subtext} mt-0.5`}>{j.address}</div>
                        {assigned.length > 0 && (
                          <div className="flex gap-2 mt-2 flex-wrap">
                            {assigned.map((a: any) => (
                              <span key={a.id} className="text-xs bg-teal-50 text-teal-700 px-2 py-1 rounded-lg font-medium">{a.name}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      <button onClick={() => setAssigningJobId(isAssigning ? null : j.id)}
                        className="text-sm border border-gray-200 text-gray-600 hover:border-teal-300 hover:text-teal-600 rounded-xl px-4 py-2 transition-colors flex-shrink-0">
                        {isAssigning ? "Done" : "Assign"}
                      </button>
                      <span className={`text-sm px-3 py-1 rounded-full font-medium flex-shrink-0 ${j.status === "active" ? "bg-teal-50 text-teal-600" : "bg-gray-100 text-gray-500"}`}>{j.status}</span>
                    </div>
                    {isAssigning && (
                      <div className="px-6 pb-5">
                        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                          <p className={`text-sm ${subtext} mb-3`}>Click to assign or unassign installers</p>
                          {installers.length === 0 ? <p className={`text-sm ${subtext}`}>No installers yet - add them in the Team tab</p>
                          : (
                            <div className="flex flex-wrap gap-2">
                              {installers.map((m: any) => {
                                const isAssigned = jobAssignments.some((a: any) => a.job_id === j.id && a.user_id === m.id)
                                return (
                                  <button key={m.id} onClick={() => toggleAssignment(j.id, m.id)}
                                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${isAssigned ? "bg-teal-400 text-white" : "bg-white text-gray-700 border border-gray-200 hover:border-teal-300"}`}>
                                    <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold">{m.initials}</div>
                                    {m.name}
                                    {isAssigned && <span>check</span>}
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
              <button onClick={() => { setShowAddMember(true); setFormError("") }} className="bg-teal-400 hover:bg-teal-500 text-white font-bold rounded-xl px-5 py-2.5 text-sm transition-colors">+ Add member</button>
            </div>
            {showAddMember && (
              <div className="bg-white border border-teal-200 rounded-2xl p-6 space-y-4 shadow-sm">
                <h3 className="font-semibold">New team member</h3>
                <input value={memberName} onChange={e => setMemberName(e.target.value)} placeholder="Full name" className={inp}/>
                <input value={memberEmail} onChange={e => setMemberEmail(e.target.value)} placeholder="Email address" type="email" className={inp}/>
                {formError && <p className="text-sm text-red-500">{formError}</p>}
                <div className="flex gap-3">
                  <button onClick={addMember} disabled={saving} className="bg-teal-400 hover:bg-teal-500 disabled:opacity-50 text-white font-bold rounded-xl px-5 py-2.5 text-sm">{saving ? "Saving..." : "Save member"}</button>
                  <button onClick={() => setShowAddMember(false)} className="bg-gray-100 text-gray-600 rounded-xl px-5 py-2.5 text-sm">Cancel</button>
                </div>
              </div>
            )}
            <div className={card}>
              <div className={cardHeader}><span className="font-semibold">Team members</span></div>
              {teamMembers.length === 0 ? <div className={`px-6 py-16 text-center ${subtext}`}>No team members yet</div>
              : teamMembers.map((m: any) => (
                <div key={m.id} className="flex items-center gap-4 px-6 py-5 border-b border-gray-50 last:border-0">
                  <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center font-bold flex-shrink-0">{m.initials}</div>
                  <div className="flex-1">
                    <div className="font-semibold">{m.name}</div>
                    <div className={`text-sm ${subtext} mt-0.5`}>{m.email || "No email"}</div>
                  </div>
                  <span className="text-sm bg-gray-100 text-gray-600 px-3 py-1 rounded-full capitalize font-medium">{m.role}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "payroll" && (
          <div className="space-y-5">
            <div className={card}>
              <div className={cardHeader}><span className="font-semibold">Hours today - by installer</span></div>
              {installers.length === 0 ? <div className={`px-6 py-16 text-center ${subtext}`}>No installers yet</div>
              : installers.map((m: any) => {
                const ms = signins.filter((s: any) => s.user_id === m.id)
                const hrs = ms.reduce((acc: number, s: any) => {
                  if (s.signed_in_at && s.signed_out_at) return acc + (new Date(s.signed_out_at).getTime() - new Date(s.signed_in_at).getTime()) / 3600000
                  return acc
                }, 0)
                return (
                  <div key={m.id} className="flex items-center gap-4 px-6 py-5 border-b border-gray-50 last:border-0">
                    <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center font-bold flex-shrink-0">{m.initials}</div>
                    <div className="flex-1">
                      <div className="font-semibold">{m.name}</div>
                      <div className={`text-sm ${subtext}`}>{m.email}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-teal-500">{hrs.toFixed(1)}h</div>
                      <div className={`text-sm ${subtext}`}>today</div>
                    </div>
                  </div>
                )
              })}
            </div>
            <p className={`text-sm ${subtext} px-1`}>Full weekly payroll coming in next build.</p>
          </div>
        )}

        {activeTab === "alerts" && (
          <div className={card}>
            <div className={cardHeader}><span className="font-semibold">SiteLog alerts</span></div>
            {alerts.length === 0 ? <div className={`px-6 py-16 text-center ${subtext}`}>No alerts - all clear</div>
            : alerts.map((a: any) => (
              <div key={a.id} className="px-6 py-5 border-b border-gray-50 last:border-0">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className={`text-sm ${subtext} mb-1`}>{a.jobs?.name} - {new Date(a.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</div>
                    <div>{a.message}</div>
                  </div>
                  <button onClick={() => markAlertRead(a.id)} className={`text-sm ${subtext} hover:text-gray-900 transition-colors flex-shrink-0 border border-gray-200 rounded-lg px-3 py-1.5`}>Dismiss</button>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  )
}

