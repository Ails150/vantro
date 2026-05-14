import { verifyInstallerToken } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const installer = verifyInstallerToken(request)
  if (!installer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = await createServiceClient()
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  // Run 4 independent queries in parallel: assignments, user+company, today's signins, today's scheduled visits
  const [assignmentsRes, userRes, signinsRes, todaysVisitsRes] = await Promise.all([
    service.from('job_assignments').select('job_id').eq('user_id', installer.userId),
    service.from('users').select('company_id, companies(background_gps_enabled)').eq('id', installer.userId).single(),
    service.from('signins').select('job_id').eq('user_id', installer.userId).gte('signed_in_at', today.toISOString()).is('signed_out_at', null),
    service.from('visit_assignments').select('visit_id, job_visits!inner(job_id)').eq('user_id', installer.userId).gte('start_at', today.toISOString()).lt('start_at', tomorrow.toISOString()),
  ])

  const assignments = assignmentsRes.data
  const me: any = userRes.data
  const signins = signinsRes.data
  const todaysJobIds = new Set<string>((todaysVisitsRes.data || []).map((v: any) => v.job_visits?.job_id).filter(Boolean))

  if (!me?.company_id) return NextResponse.json({ jobs: [] })

  // Pick jobs strategy based on whether this installer has direct assignments
  let jobs: any[] = []
  // Strict: installer only sees jobs they are explicitly assigned to.
  // If zero assignments, they see zero jobs. Admin must assign jobs in scheduler.
  if (assignments?.length) {
    const jobIds = assignments.map((a: any) => a.job_id)
    const { data: assignedJobs } = await service.from('jobs').select('*').in('id', jobIds).eq('status', 'active')
    jobs = assignedJobs || []
  } else {
    jobs = []
  }

  // Fetch ALL checklists for all jobs in ONE query, then group client-side
  let checklistsByJob: Record<string, any[]> = {}
  if (jobs.length) {
    const jobIds = jobs.map((j: any) => j.id)
    const { data: allChecklists } = await service
      .from('job_checklists')
      .select('id, job_id, template_id, checklist_templates(name), checklist_items(id, label, item_type, mandatory, sort_order)')
      .in('job_id', jobIds)
    for (const cl of allChecklists || []) {
      const jid = (cl as any).job_id
      if (!checklistsByJob[jid]) checklistsByJob[jid] = []
      checklistsByJob[jid].push(cl)
    }
  }

  const signedInJobIds = new Set(signins?.map((s: any) => s.job_id) || [])

  const jobsWithData = jobs.map((j: any) => ({
    ...j,
    signed_in: signedInJobIds.has(j.id),
    is_today: todaysJobIds.has(j.id),
    checklists: checklistsByJob[j.id] || [],
  })).sort((a: any, b: any) => {
    if (a.is_today && !b.is_today) return -1
    if (!a.is_today && b.is_today) return 1
    return 0
  })

  const companySettings = {
    background_gps_enabled: me.companies?.background_gps_enabled ?? true,
  }

  return NextResponse.json({ jobs: jobsWithData, company_settings: companySettings })
}