import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const service = await createServiceClient()
  const { data: userData } = await service.from('users').select('company_id').eq('auth_user_id', user.id).single()
  if (!userData) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const companyId = userData.company_id

  const now = new Date()
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7))
  weekStart.setHours(0, 0, 0, 0)
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0)
  const sevenDaysAgo = new Date(now); sevenDaysAgo.setDate(now.getDate() - 7)

  const [qaRes, alertsRes, signinsWeekRes, signinsTodayRes, signinsJobRes, stalledRes] = await Promise.all([
    service.from('qa_submissions').select('state').eq('company_id', companyId),
    service.from('alerts').select('id').eq('company_id', companyId).gte('created_at', weekStart.toISOString()),
    service.from('signins').select('user_id, signed_in_at, signed_out_at, users(name, initials)').eq('company_id', companyId).gte('signed_in_at', weekStart.toISOString()).not('signed_out_at', 'is', null),
    service.from('signins').select('user_id').eq('company_id', companyId).gte('signed_in_at', todayStart.toISOString()),
    service.from('signins').select('job_id, signed_in_at, signed_out_at, jobs(name)').eq('company_id', companyId).not('signed_out_at', 'is', null),
    service.from('signins').select('job_id').eq('company_id', companyId).lt('signed_in_at', sevenDaysAgo.toISOString()),
  ])

  const approved_qa = qaRes.data?.filter((q: any) => q.state === 'approved').length || 0
  const rejected_qa = qaRes.data?.filter((q: any) => q.state === 'rejected').length || 0
  const alerts_this_week = alertsRes.data?.length || 0
  const signed_in_today = [...new Set(signinsTodayRes.data?.map((s: any) => s.user_id) || [])]

  const hoursByInstaller: Record<string, any> = {}
  signinsWeekRes.data?.forEach((s: any) => {
    if (!s.signed_in_at || !s.signed_out_at) return
    const hrs = (new Date(s.signed_out_at).getTime() - new Date(s.signed_in_at).getTime()) / 3600000
    if (!hoursByInstaller[s.user_id]) hoursByInstaller[s.user_id] = { installer_id: s.user_id, name: s.users?.name, initials: s.users?.initials, hours: 0 }
    hoursByInstaller[s.user_id].hours += hrs
  })
  const hours_this_week = Object.values(hoursByInstaller).sort((a: any, b: any) => b.hours - a.hours)
  const max_hours = hours_this_week.length ? Math.max(...hours_this_week.map((h: any) => h.hours)) : 1

  const hoursByJob: Record<string, any> = {}
  signinsJobRes.data?.forEach((s: any) => {
    if (!s.signed_in_at || !s.signed_out_at || !s.job_id) return
    const hrs = (new Date(s.signed_out_at).getTime() - new Date(s.signed_in_at).getTime()) / 3600000
    if (!hoursByJob[s.job_id]) hoursByJob[s.job_id] = { job_id: s.job_id, name: s.jobs?.name, hours: 0 }
    hoursByJob[s.job_id].hours += hrs
  })
  const hours_per_job = Object.values(hoursByJob).sort((a: any, b: any) => b.hours - a.hours)
  const max_job_hours = hours_per_job.length ? Math.max(...hours_per_job.map((h: any) => h.hours)) : 1

  const activeJobIds = new Set(stalledRes.data?.map((s: any) => s.job_id) || [])
  const recentJobIds = new Set(
    (await service.from('signins').select('job_id').eq('company_id', companyId).gte('signed_in_at', sevenDaysAgo.toISOString())).data?.map((s: any) => s.job_id) || []
  )
  const stalled_job_ids = [...activeJobIds].filter(id => !recentJobIds.has(id))

  return NextResponse.json({ approved_qa, rejected_qa, alerts_this_week, signed_in_today, hours_this_week, max_hours, hours_per_job, max_job_hours, stalled_job_ids })
}
