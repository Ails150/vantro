# VANTRO — Full Admin Dashboard
New-Item -Path "app\admin" -ItemType Directory -Force | Out-Null
New-Item -Path "components\admin" -ItemType Directory -Force | Out-Null

$adminPage = @'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AdminDashboard from '@/components/admin/AdminDashboard'

export default async function AdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Get company for this user
  const { data: userData } = await supabase
    .from('users')
    .select('*, companies(*)')
    .eq('auth_user_id', user.id)
    .single()

  // Get jobs
  const companyId = userData?.company_id
  const { data: jobs } = companyId ? await supabase
    .from('jobs')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false }) : { data: [] }

  // Get sign ins today
  const today = new Date()
  today.setHours(0,0,0,0)
  const { data: signins } = companyId ? await supabase
    .from('signins')
    .select('*, users(name, initials)')
    .eq('company_id', companyId)
    .gte('signed_in_at', today.toISOString())
    .is('signed_out_at', null) : { data: [] }

  // Get unread alerts
  const { data: alerts } = companyId ? await supabase
    .from('alerts')
    .select('*, jobs(name)')
    .eq('company_id', companyId)
    .eq('is_read', false)
    .order('created_at', { ascending: false })
    .limit(10) : { data: [] }

  // Get pending QA
  const { data: pendingQA } = companyId ? await supabase
    .from('qa_submissions')
    .select('*, jobs(name), users(name, initials), checklist_items(label)')
    .eq('company_id', companyId)
    .eq('state', 'submitted')
    .order('submitted_at', { ascending: false }) : { data: [] }

  // Get all company users
  const { data: teamMembers } = companyId ? await supabase
    .from('users')
    .select('*')
    .eq('company_id', companyId)
    .eq('is_active', true) : { data: [] }

  return (
    <AdminDashboard
      user={user}
      userData={userData}
      jobs={jobs || []}
      signins={signins || []}
      alerts={alerts || []}
      pendingQA={pendingQA || []}
      teamMembers={teamMembers || []}
    />
  )
}
'@
Set-Content -Path "app\admin\page.tsx" -Value $adminPage -Encoding UTF8

$dashboard = @'
'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

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
  const [activeTab, setActiveTab] = useState('overview')
  const router = useRouter()
  const supabase = createClient()

  const companyName = userData?.companies?.name || 'Your Company'

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  async function approveQA(id: string) {
    await supabase.from('qa_submissions').update({ state: 'approved', reviewed_at: new Date().toISOString() }).eq('id', id)
    router.refresh()
  }

  async function rejectQA(id: string, note: string) {
    await supabase.from('qa_submissions').update({ state: 'rejected', rejection_note: note, reviewed_at: new Date().toISOString() }).eq('id', id)
    router.refresh()
  }

  async function markAlertRead(id: string) {
    await supabase.from('alerts').update({ is_read: true }).eq('id', id)
    router.refresh()
  }

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'approvals', label: 'Approvals', badge: pendingQA.length },
    { id: 'jobs', label: 'Jobs' },
    { id: 'team', label: 'Team' },
    { id: 'alerts', label: 'Alerts', badge: alerts.length },
  ]

  return (
    <div className="min-h-screen bg-[#0f1923] text-white">
      {/* Header */}
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
          <button onClick={handleSignOut} className="text-xs text-[#4d6478] hover:text-white transition-colors border border-white/5 rounded-full px-3 py-1">
            Sign out
          </button>
        </div>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-4 gap-3 px-6 py-4">
        {[
          { label: 'On site', value: signins.length, color: '#00d4a0' },
          { label: 'Jobs today', value: jobs.filter(j => j.status === 'active').length, color: '#f0f4f8' },
          { label: 'Awaiting review', value: pendingQA.length, color: '#f59e0b' },
          { label: 'Alerts', value: alerts.length, color: '#ef4444' },
        ].map(s => (
          <div key={s.label} className="bg-[#1a2635] border border-white/5 rounded-xl p-4">
            <div className="text-[#4d6478] text-xs font-medium uppercase tracking-wide mb-2">{s.label}</div>
            <div className="text-2xl font-semibold" style={{ color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-white/5 px-6">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-[#00d4a0] text-[#00d4a0]'
                : 'border-transparent text-[#4d6478] hover:text-white'
            }`}
          >
            {tab.label}
            {tab.badge ? (
              <span className="bg-[#00d4a0]/10 text-[#00d4a0] text-xs font-semibold px-1.5 py-0.5 rounded-full">
                {tab.badge}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="px-6 py-6 max-w-6xl">

        {/* OVERVIEW */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-2 gap-4">
            {/* Live on site */}
            <div className="bg-[#1a2635] border border-white/5 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
                <span className="text-sm font-medium">Live on site</span>
                <span className="text-xs bg-[#00d4a0]/10 text-[#00d4a0] px-2 py-0.5 rounded-full">{signins.length} active</span>
              </div>
              {signins.length === 0 ? (
                <div className="px-5 py-8 text-center text-[#4d6478] text-sm">No one signed in yet today</div>
              ) : signins.map((s: any) => (
                <div key={s.id} className="flex items-center gap-3 px-5 py-3 border-b border-white/5 last:border-0">
                  <div className="w-8 h-8 rounded-full bg-[#00d4a0]/10 flex items-center justify-center text-xs font-semibold text-[#00d4a0]">
                    {s.users?.initials || '?'}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium">{s.users?.name || 'Unknown'}</div>
                    <div className="text-xs text-[#4d6478]">Signed in {new Date(s.signed_in_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#00d4a0]"/>
                    <span className="text-xs text-[#00d4a0]">On site</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Recent alerts */}
            <div className="bg-[#1a2635] border border-white/5 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
                <span className="text-sm font-medium">SiteLog alerts</span>
                {alerts.length > 0 && <span className="text-xs bg-red-400/10 text-red-400 px-2 py-0.5 rounded-full">{alerts.length} unread</span>}
              </div>
              {alerts.length === 0 ? (
                <div className="px-5 py-8 text-center text-[#4d6478] text-sm">No alerts — all clear</div>
              ) : alerts.slice(0,5).map((a: any) => (
                <div key={a.id} className="px-5 py-3 border-b border-white/5 last:border-0">
                  <div className="flex items-start gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${a.alert_type === 'blocker' ? 'bg-red-400' : 'bg-yellow-400'}`}/>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-[#4d6478] mb-0.5">{a.jobs?.name}</div>
                      <div className="text-sm">{a.message}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Jobs list */}
            <div className="bg-[#1a2635] border border-white/5 rounded-xl overflow-hidden col-span-2">
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
                <span className="text-sm font-medium">Active jobs</span>
                <span className="text-xs text-[#4d6478]">{jobs.length} total</span>
              </div>
              {jobs.length === 0 ? (
                <div className="px-5 py-8 text-center text-[#4d6478] text-sm">No jobs yet — create one in the Jobs tab</div>
              ) : jobs.slice(0,5).map((j: any) => (
                <div key={j.id} className="flex items-center gap-4 px-5 py-3 border-b border-white/5 last:border-0">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{j.name}</div>
                    <div className="text-xs text-[#4d6478] truncate">{j.address}</div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    j.status === 'active' ? 'bg-[#00d4a0]/10 text-[#00d4a0]' :
                    j.status === 'completed' ? 'bg-blue-400/10 text-blue-400' :
                    'bg-white/5 text-[#4d6478]'
                  }`}>{j.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* APPROVALS */}
        {activeTab === 'approvals' && (
          <div className="bg-[#1a2635] border border-white/5 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/5">
              <span className="text-sm font-medium">QA approval queue</span>
            </div>
            {pendingQA.length === 0 ? (
              <div className="px-5 py-12 text-center text-[#4d6478] text-sm">Nothing waiting for approval</div>
            ) : pendingQA.map((qa: any) => (
              <div key={qa.id} className="px-5 py-4 border-b border-white/5 last:border-0">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-6 h-6 rounded-full bg-[#00d4a0]/10 flex items-center justify-center text-xs font-semibold text-[#00d4a0]">
                        {qa.users?.initials || '?'}
                      </div>
                      <span className="text-sm font-medium">{qa.users?.name}</span>
                      <span className="text-xs text-[#4d6478]">on {qa.jobs?.name}</span>
                    </div>
                    <div className="text-sm text-[#8fa3b8] mb-1">{qa.checklist_items?.label}</div>
                    {qa.value && <div className="text-xs text-[#4d6478]">Value: {qa.value}</div>}
                    {qa.notes && <div className="text-xs text-[#4d6478]">Note: {qa.notes}</div>}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => approveQA(qa.id)}
                      className="bg-[#00d4a0]/10 hover:bg-[#00d4a0]/20 text-[#00d4a0] border border-[#00d4a0]/20 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => {
                        const note = window.prompt('Rejection reason:')
                        if (note) rejectQA(qa.id, note)
                      }}
                      className="bg-red-400/10 hover:bg-red-400/20 text-red-400 border border-red-400/20 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* JOBS */}
        {activeTab === 'jobs' && (
          <div className="space-y-4">
            <div className="bg-[#1a2635] border border-white/5 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-white/5">
                <span className="text-sm font-medium">All jobs</span>
              </div>
              {jobs.length === 0 ? (
                <div className="px-5 py-12 text-center text-[#4d6478] text-sm">No jobs yet</div>
              ) : jobs.map((j: any) => (
                <div key={j.id} className="flex items-center gap-4 px-5 py-4 border-b border-white/5 last:border-0">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{j.name}</div>
                    <div className="text-xs text-[#4d6478]">{j.address}</div>
                    <div className="text-xs text-[#4d6478] mt-0.5">Created {new Date(j.created_at).toLocaleDateString('en-GB')}</div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
                    j.status === 'active' ? 'bg-[#00d4a0]/10 text-[#00d4a0]' :
                    j.status === 'completed' ? 'bg-blue-400/10 text-blue-400' :
                    'bg-white/5 text-[#4d6478]'
                  }`}>{j.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TEAM */}
        {activeTab === 'team' && (
          <div className="bg-[#1a2635] border border-white/5 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/5">
              <span className="text-sm font-medium">Team members</span>
            </div>
            {teamMembers.length === 0 ? (
              <div className="px-5 py-12 text-center text-[#4d6478] text-sm">No team members yet</div>
            ) : teamMembers.map((m: any) => (
              <div key={m.id} className="flex items-center gap-3 px-5 py-3 border-b border-white/5 last:border-0">
                <div className="w-9 h-9 rounded-full bg-[#243040] flex items-center justify-center text-sm font-semibold">
                  {m.initials}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium">{m.name}</div>
                  <div className="text-xs text-[#4d6478]">{m.email || 'No email'}</div>
                </div>
                <span className="text-xs bg-white/5 text-[#8fa3b8] px-2 py-0.5 rounded-full capitalize">{m.role}</span>
              </div>
            ))}
          </div>
        )}

        {/* ALERTS */}
        {activeTab === 'alerts' && (
          <div className="bg-[#1a2635] border border-white/5 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/5">
              <span className="text-sm font-medium">SiteLog alerts</span>
            </div>
            {alerts.length === 0 ? (
              <div className="px-5 py-12 text-center text-[#4d6478] text-sm">No alerts — all clear</div>
            ) : alerts.map((a: any) => (
              <div key={a.id} className="px-5 py-4 border-b border-white/5 last:border-0">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                      a.alert_type === 'blocker' ? 'bg-red-400' :
                      a.alert_type === 'issue' ? 'bg-yellow-400' : 'bg-blue-400'
                    }`}/>
                    <div>
                      <div className="text-xs text-[#4d6478] mb-1">{a.jobs?.name} · {new Date(a.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>
                      <div className="text-sm">{a.message}</div>
                    </div>
                  </div>
                  <button
                    onClick={() => markAlertRead(a.id)}
                    className="text-xs text-[#4d6478] hover:text-white transition-colors flex-shrink-0"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  )
}
'@
Set-Content -Path "components\admin\AdminDashboard.tsx" -Value $dashboard -Encoding UTF8

Write-Host "Done" -ForegroundColor Green
