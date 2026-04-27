import { verifyInstallerToken } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const installer = verifyInstallerToken(request)
  if (!installer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = await createServiceClient()
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Run 3 independent queries in parallel: assignments, user+company, today's signins
  const [assignmentsRes, userRes, signinsRes] = await Promise.all([
    service.from('job_assignments').select('job_id').eq('user_id', installer.userId),
    service.from('users').select('company_id, companies(background_gps_enabled)').eq('id', installer.userId).single(),
    service.from('signins').select('job_id').eq('user_id', installer.userId).gte('signed_in_at', today.toISOString()).is('signed_out_at', null),
  ])

  const assignments = assignmentsRes.data
  const me: any = userRes.data
  const signins = signinsRes.data

  if (!me?.company_id) return NextResponse.json({ jobs: [] })

  // Pick jobs strategy based on whether this installer has direct assignments
  let jobs: any[] = []
  if (assignments?.length) {
    const jobIds = assignments.map((a: any) => a.job_id)
    const { data: assignedJobs } = await service.from('jobs').select('*').in('id', jobIds).eq('status', 'active')
    jobs = assignedJobs || []
  } else {
    const { data: allJobs } = await service.from('jobs').select('*').eq('company_id', me.company_id).eq('status', 'active')
    jobs = allJobs || []
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
    checklists: checklistsByJob[j.id] || [],
  }))

  const companySettings = {
    background_gps_enabled: me.companies?.background_gps_enabled ?? true,
  }

  return NextResponse.json({ jobs: jobsWithData, company_settings: companySettings })
}
