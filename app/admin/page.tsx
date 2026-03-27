import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AdminDashboard from '@/components/admin/AdminDashboard'

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const params = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('id, company_id, name, role')
    .eq('auth_user_id', user.id)
    .in('role', ['admin', 'foreman'])
    .single()

  if (userError || !userData || !userData.company_id) redirect('/onboarding')

  const companyId = userData.company_id
  const { data: jobs } = await supabase.from('jobs').select('*').eq('company_id', companyId).order('created_at', { ascending: false })
  const today = new Date(); today.setHours(0,0,0,0)
  const { data: signins } = await supabase.from('signins').select('*, users(name, initials)').eq('company_id', companyId).gte('signed_in_at', today.toISOString()).is('signed_out_at', null)
  const { data: alerts } = await supabase.from('alerts').select('*, jobs(name)').eq('company_id', companyId).eq('is_read', false).order('created_at', { ascending: false }).limit(10)
  const { data: pendingQA } = await supabase.from('qa_approvals').select('*, jobs(name, address), users(name, initials)').eq('company_id', companyId).eq('status', 'pending').order('submitted_at', { ascending: false })
  const { data: teamMembers } = await supabase.from('users').select('*').eq('company_id', companyId)
  const { data: jobAssignments } = await supabase.from('job_assignments').select('*').eq('company_id', companyId)
  const { data: checklistTemplates } = await supabase.from('checklist_templates').select('*, checklist_items(*)').eq('company_id', companyId).order('created_at', { ascending: false })
  const { data: diaryEntries } = await supabase.from('diary_entries').select('*, jobs(name), users(name, initials)').eq('company_id', companyId).order('created_at', { ascending: false }).limit(50)

  return (
    <AdminDashboard
      user={user}
      userData={userData}
      jobs={jobs || []}
      signins={signins || []}
      alerts={alerts || []}
      pendingQA={pendingQA || []}
      teamMembers={teamMembers || []}
      jobAssignments={jobAssignments || []}
      checklistTemplates={checklistTemplates || []}
      diaryEntries={diaryEntries || []}
      defaultTab={params.tab || "overview"}
    />
  )
}

