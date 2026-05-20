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

  const [assignmentsRes, userRes, signinsRes, upcomingVisitsRes] = await Promise.all([
    service.from('job_assignments').select('job_id').eq('user_id', installer.userId),
    service.from('users').select('company_id, companies(background_gps_enabled)').eq('id', installer.userId).single(),
    service.from('signins').select('job_id').eq('user_id', installer.userId).gte('signed_in_at', today.toISOString()).is('signed_out_at', null),
    service.from('visit_assignments').select('visit_id, start_at, job_visits!inner(job_id)').eq('user_id', installer.userId).gte('start_at', today.toISOString()),
  ])

  // installer-jobs-debug-2026-05-20
  if (assignmentsRes.error) console.error('[installer/jobs] assignments error:', assignmentsRes.error)
  if (userRes.error) console.error('[installer/jobs] user error:', userRes.error)
  if (signinsRes.error) console.error('[installer/jobs] signins error:', signinsRes.error)
  if (upcomingVisitsRes.error) console.error('[installer/jobs] visits error:', upcomingVisitsRes.error)
  console.log('[installer/jobs] installer=', installer.userId, 'assignments=', assignmentsRes.data?.length, 'visits=', upcomingVisitsRes.data?.length)

  const assignments = assignmentsRes.data
  const me: any = userRes.data
  const signins = signinsRes.data
  const upcomingVisits = upcomingVisitsRes.data || []

  if (!me?.company_id) return NextResponse.json({ jobs: [] })

  const todaysJobIds = new Set<string>(
    upcomingVisits
      .filter((v: any) => v.start_at && new Date(v.start_at) < tomorrow)
      .map((v: any) => v.job_visits?.job_id)
      .filter(Boolean)
  )

  const accessJobIds = new Set<string>()
  for (const a of assignments || []) {
    if (a.job_id) accessJobIds.add(a.job_id)
  }
  for (const v of upcomingVisits) {
    const jid = (v as any).job_visits?.job_id
    if (jid) accessJobIds.add(jid)
  }

  let jobs: any[] = []
  if (accessJobIds.size > 0) {
    const { data: accessibleJobs } = await service
      .from('jobs')
      .select('*')
      .in('id', Array.from(accessJobIds))
      .eq('status', 'active')
    jobs = accessibleJobs || []
  }

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
