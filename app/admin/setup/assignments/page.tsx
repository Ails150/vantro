import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AssignmentsMatrix from '@/components/admin/setup/AssignmentsMatrix'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function AssignmentsPage() {
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

  return <AssignmentsMatrix />
}