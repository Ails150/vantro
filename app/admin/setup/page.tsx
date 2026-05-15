import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import SetupWizard from '@/components/admin/setup/SetupWizard'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function SetupPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('id, company_id, name, role')
    .eq('auth_user_id', user.id)
    .in('role', ['admin', 'foreman', 'superadmin'])
    .single()

  if (!userData?.company_id) redirect('/onboarding')

  const { data: company } = await supabase
    .from('companies')
    .select('*')
    .eq('id', userData.company_id)
    .single()

  // If already completed, bounce back to dashboard
  if (company?.onboarding_completed_at) redirect('/admin')

  // Live counts to determine which step is current
  const { count: jobsCount } = await supabase
    .from('jobs')
    .select('*', { count: 'exact', head: true })
    .eq('company_id', userData.company_id)

  const { count: teamCount } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true })
    .eq('company_id', userData.company_id)
    .in('role', ['installer', 'foreman'])

  const { count: assignmentsCount } = await supabase
    .from('job_assignments')
    .select('*', { count: 'exact', head: true })
    .eq('company_id', userData.company_id)

  const { count: schedulesCount } = await supabase
    .from('user_shifts')
    .select('*', { count: 'exact', head: true })
    .eq('company_id', userData.company_id)

  return (
    <SetupWizard
      companyName={company?.name || 'Your company'}
      userName={userData.name || 'there'}
      jobsCount={jobsCount || 0}
      teamCount={teamCount || 0}
      assignmentsCount={assignmentsCount || 0}
      schedulesCount={schedulesCount || 0}
    />
  )
}