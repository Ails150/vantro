import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const service = await createServiceClient()
  const { data: userData } = await service.from('users').select('company_id, role').eq('auth_user_id', user.id).single()
  if (!userData || userData.role !== 'admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { jobId } = await request.json()

  await service.from('job_assignments').delete().eq('job_id', jobId)
  await service.from('signins').delete().eq('job_id', jobId)
  await service.from('diary_entries').delete().eq('job_id', jobId)
  await service.from('qa_submissions').delete().eq('job_id', jobId)
  await service.from('qa_approvals').delete().eq('job_id', jobId)
  await service.from('defects').delete().eq('job_id', jobId)
  await service.from('alerts').delete().eq('job_id', jobId)
  const { error } = await service.from('jobs').delete().eq('id', jobId).eq('company_id', userData.company_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
