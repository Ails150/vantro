import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const service = await createServiceClient()
  const { data: userData } = await service.from('users').select('id, company_id, role').eq('auth_user_id', user.id).single()
  if (!userData || !['admin', 'superadmin'].includes(userData.role)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { jobId } = await request.json()

  const { error } = await service
    .from('jobs')
    .update({ archived_at: new Date().toISOString(), archived_by: userData.id })
    .eq('id', jobId)
    .eq('company_id', userData.company_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
