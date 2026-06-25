import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AdminDashboard from '@/components/admin/AdminDashboard'
import SupportBanner from '@/components/support/SupportBanner'
import { getCallerContext } from '@/lib/company-context'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const DASHBOARD_ROLES = ['admin', 'foreman', 'superadmin', 'support']

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ tab?: string; from?: string }> }) {
  const params = await searchParams
  const supabase = await createClient()
  const ctx = await getCallerContext()
  if (!ctx) redirect('/login')
  if (!DASHBOARD_ROLES.includes(ctx.role)) redirect('/onboarding')

  // Support users must pick a company first (their effective company comes from
  // the switcher cookie, not their own row).
  if (ctx.isSupport && !ctx.companyId) redirect('/support')
  if (!ctx.companyId) redirect('/onboarding')

  const user = { id: ctx.authUserId }
  const userData = { id: ctx.userId, company_id: ctx.companyId, name: ctx.name, role: ctx.role }
  const companyId = ctx.companyId

  // PERF: fetch the company alongside the dashboard data in one parallel batch
  // (previously company was a separate sequential round-trip before this batch).
  const today = new Date(); today.setHours(0,0,0,0)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const [
    companyResult,
    jobsResult,
    signinsResult,
    alertsResult,
    resolvedAlertsResult,
    pendingQAResult,
    teamMembersResult,
    jobAssignmentsResult,
    checklistTemplatesResult,
    diaryEntriesResult,
  ] = await Promise.all([
    supabase.from('companies').select('*').eq('id', companyId).single(),
    supabase
      .from('jobs')
      .select('*, job_checklists(template_id)')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false }),
    supabase
      .from('signins')
      .select('*, users(name, initials)')
      .eq('company_id', companyId)
      .gte('signed_in_at', today.toISOString())
      .is('signed_out_at', null),
    supabase
      .from('alerts')
      .select('*, jobs(name), users(name, initials), diary_entries(photo_urls, video_url)')
      .eq('company_id', companyId)
      .eq('is_read', false)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('alerts')
      .select('*, jobs(name), users(name), diary_entries(photo_urls, video_url)')
      .eq('company_id', companyId)
      .eq('status', 'resolved')
      .gte('resolved_at', sevenDaysAgo)
      .order('resolved_at', { ascending: false })
      .limit(50),
    supabase
      .from('qa_approvals')
      .select('*, jobs(name, address), users(name, initials)')
      .eq('company_id', companyId)
      .eq('status', 'pending')
      .order('submitted_at', { ascending: false }),
    supabase
      .from('users')
      .select('*')
      .eq('company_id', companyId)
      .neq('role', 'support'),
    supabase
      .from('job_assignments')
      .select('*')
      .eq('company_id', companyId),
    supabase
      .from('checklist_templates')
      .select('*, checklist_items(*)')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false }),
    supabase
      .from('diary_entries')
      .select('*, jobs(name), users!diary_entries_user_id_fkey(name, initials, id)')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(200),
  ])

  const company = companyResult.data

  // Setup wizard redirect: if onboarding not completed, send to setup
  // EXCEPT when admin came from the wizard intending to use a tab (Jobs, Team).
  // Support users skip this — they're viewing an existing company, not onboarding.
  if (!ctx.isSupport && company && !company.onboarding_completed_at && params.from !== 'setup') {
    redirect('/admin/setup')
  }

  // Trial/subscription check
  // paywall_overlay_v1
  let trialExpiredAndUnpaid = false
  if (company && !ctx.isSupport) {
    const now = new Date()
    const trialEnds = company.trial_ends_at ? new Date(company.trial_ends_at) : null
    const status = company.subscription_status
    const trialExpired = trialEnds && now > trialEnds
    const notActive = !status || status === 'trial' || status === 'cancelled' || status === 'past_due'
    trialExpiredAndUnpaid = !!(trialExpired && notActive)
  }

  return (
    <>
      {ctx.isSupport && <SupportBanner companyName={company?.name || 'this company'} />}
      <AdminDashboard
        user={user}
        userData={userData}
        company={company}
        trialExpiredAndUnpaid={trialExpiredAndUnpaid}
        jobs={jobsResult.data || []}
        signins={signinsResult.data || []}
        alerts={alertsResult.data || []} resolvedAlerts={resolvedAlertsResult.data || []}
        pendingQA={pendingQAResult.data || []}
        teamMembers={teamMembersResult.data || []}
        jobAssignments={jobAssignmentsResult.data || []}
        checklistTemplates={checklistTemplatesResult.data || []}
        diaryEntries={diaryEntriesResult.data || []}
        defaultTab={params.tab || "overview"}
      />
    </>
  )
}
