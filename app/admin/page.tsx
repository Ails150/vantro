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
