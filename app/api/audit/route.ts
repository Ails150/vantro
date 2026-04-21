import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const jobId = searchParams.get('jobId')
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  if (!jobId) return NextResponse.json({ error: 'No jobId' }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = await createServiceClient()
  const { data: u } = await service.from('users').select('company_id').eq('auth_user_id', user.id).single()
  if (!u) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const { data: job } = await service.from('jobs').select('name, address').eq('id', jobId).eq('company_id', u.company_id).single()
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  let diaryQuery = service.from('diary_entries')
    .select('id, entry_text, ai_alert_type, ai_summary, photo_urls, video_url, created_at, users(name)')
    .eq('job_id', jobId)
    .order('created_at', { ascending: true })
  if (from) diaryQuery = diaryQuery.gte('created_at', from)
  if (to) diaryQuery = diaryQuery.lte('created_at', to + 'T23:59:59Z')
  const { data: diary } = await diaryQuery

  let signinsQuery = service.from('signins')
    .select('signed_in_at, signed_out_at, distance_metres, sign_out_distance_metres, users(name)')
    .eq('job_id', jobId)
    .order('signed_in_at', { ascending: true })
  if (from) signinsQuery = signinsQuery.gte('signed_in_at', from)
  if (to) signinsQuery = signinsQuery.lte('signed_in_at', to + 'T23:59:59Z')
  const { data: signins } = await signinsQuery

  let qaQuery = service.from('checklist_responses')
    .select('created_at, result, note, photo_url, checklist_items(label), users(name)')
    .eq('job_id', jobId)
    .order('created_at', { ascending: true })
  if (from) qaQuery = qaQuery.gte('created_at', from)
  if (to) qaQuery = qaQuery.lte('created_at', to + 'T23:59:59Z')
  const { data: qa } = await qaQuery

  return NextResponse.json({
    job,
    period: { from, to },
    diary: diary || [],
    signins: signins || [],
    qa: qa || [],
    generated: new Date().toISOString()
  })
}