import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

function getInstallerFromToken(request: Request) {
  const auth = request.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return null
  try {
    const payload = JSON.parse(Buffer.from(auth.slice(7), 'base64').toString())
    if (payload.exp < Date.now()) return null
    return payload
  } catch { return null }
}

export async function GET(request: Request) {
  const installer = getInstallerFromToken(request)
  if (!installer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = await createServiceClient()

  const { data: assignments } = await service
    .from('job_assignments')
    .select('job_id')
    .eq('user_id', installer.userId)

  let jobs: any[] = []

  if (!assignments?.length) {
    const { data: companyUser } = await service.from("users").select("company_id").eq("id", installer.userId).single()
    if (!companyUser?.company_id) return NextResponse.json({ jobs: [] })
    const { data: allJobs } = await service.from("jobs").select("*").eq("company_id", companyUser.company_id).eq("status", "active")
    jobs = allJobs || []
  } else {
    const jobIds = assignments.map((a: any) => a.job_id)
    const { data: assignedJobs } = await service.from('jobs').select('*').in('id', jobIds).eq('status', 'active')
    jobs = assignedJobs || []
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const { data: signins } = await service
    .from('signins')
    .select('job_id')
    .eq('user_id', installer.userId)
    .gte('signed_in_at', today.toISOString())
    .is('signed_out_at', null)

  const signedInJobIds = new Set(signins?.map((s: any) => s.job_id) || [])

  const jobsWithData = await Promise.all((jobs).map(async (j: any) => {
    const { data: checklists } = await service
      .from('job_checklists')
      .select('id, checklist_template_id, checklist_templates(name), checklist_items(id, label, item_type, mandatory, order_index)')
      .eq('job_id', j.id)
    return {
      ...j,
      signed_in: signedInJobIds.has(j.id),
      checklists: checklists || []
    }
  }))

  return NextResponse.json({ jobs: jobsWithData })
}
