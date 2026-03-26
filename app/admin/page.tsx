import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AdminDashboard from '@/components/admin/AdminDashboard'

export default async function AdminPage() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  
  if (!user) {
    console.log('No user found, redirecting to login')
    redirect('/login')
  }

  console.log('User ID:', user.id)

  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('id, company_id, name, role')
    .eq('auth_user_id', user.id)
    .eq('role', 'admin')
    .single()

  console.log('userData:', JSON.stringify(userData))
  console.log('userError:', JSON.stringify(userError))

  if (userError || !userData || !userData.company_id) {
    console.log('No userData found, redirecting to onboarding')
    redirect('/onboarding')
  }

  const companyId = userData.company_id
  const { data: jobs } = await supabase.from('jobs').select('*').eq('company_id', companyId).order('created_at', { ascending: false })
  const today = new Date(); today.setHours(0,0,0,0)
  const { data: signins } = await supabase.from('signins').select('*, users(name, initials)').eq('company_id', companyId).gte('signed_in_at', today.toISOString()).is('signed_out_at', null)
  const { data: alerts } = await supabase.from('alerts').select('*, jobs(name)').eq('company_id', companyId).eq('is_read', false).order('created_at', { ascending: false }).limit(10)
  const { data: pendingQA } = await supabase.from('qa_submissions').select('*, jobs(name), users(name, initials)').eq('company_id', companyId).eq('state', 'submitted').order('submitted_at', { ascending: false })
  const { data: teamMembers } = await supabase.from('users').select('*').eq('company_id', companyId)

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
