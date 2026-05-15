import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import DefaultHoursSetup from '@/components/admin/setup/DefaultHoursSetup'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function HoursPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('id, company_id, role')
    .eq('auth_user_id', user.id)
    .in('role', ['admin', 'foreman', 'superadmin'])
    .single()

  if (!userData?.company_id) redirect('/onboarding')

  const { count: teamCount } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true })
    .eq('company_id', userData.company_id)
    .in('role', ['installer', 'foreman'])
    .eq('is_active', true)

  return <DefaultHoursSetup teamCount={teamCount || 0} />
}