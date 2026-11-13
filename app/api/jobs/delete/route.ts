import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { ownedJobId } from '@/lib/job-ownership'
import { anyWeekLocked } from '@/lib/payroll-runs'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const service = await createServiceClient()
  const { data: userData } = await service.from('users').select('company_id, role').eq('auth_user_id', user.id).single()
  if (!userData || userData.role !== 'admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))

  // Ownership first. Every delete below is keyed on this id alone, so this is
  // the only thing stopping one company deleting another company's records.
  const jobId = await ownedJobId(service, body?.jobId, userData.company_id)
  if (!jobId) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const { data: shifts } = await service.from('signins').select('signed_in_at').eq('job_id', jobId).limit(20000)
  if (await anyWeekLocked(service, userData.company_id, (shifts || []).map((s: any) => s.signed_in_at))) {
    return NextResponse.json({ error: 'This job has shifts in an approved payroll week. Unlock that week first.', code: 'WEEK_LOCKED' }, { status: 423 })
  }

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
