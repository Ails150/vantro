import { verifyInstallerToken } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const installer = verifyInstallerToken(request)
  if (!installer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = new URL(request.url)
  const jobId = searchParams.get('jobId')
  if (!jobId) return NextResponse.json({ error: 'Missing jobId' }, { status: 400 })

  const service = await createServiceClient()

  const { data: jobChecklists } = await service
    .from('job_checklists')
    .select('template_id, checklist_templates(id, name, requires_approval, audit_only, checklist_items(*))')
    .eq('job_id', jobId)

  if (!jobChecklists?.length) return NextResponse.json({ checklists: [], items: [], submissions: [] })

  const { data: submissions } = await service
    .from('qa_submissions')
    .select('*')
    .eq('job_id', jobId)
    .eq('user_id', installer.userId)

  const checklists = jobChecklists.map((jc: any) => ({
    ...jc.checklist_templates,
    items: jc.checklist_templates?.checklist_items?.sort((a: any, b: any) => (a.sort_order||0) - (b.sort_order||0)) || [],
    submissions: submissions?.filter((s: any) => s.template_id === jc.template_id) || []
  }))

  const allItems = checklists.flatMap((c: any) => c.items.map((i: any) => ({ ...i, template_name: c.name })))

  return NextResponse.json({ checklists, items: allItems, submissions: submissions || [] })
}

export async function POST(request: Request) {
  const installer = verifyInstallerToken(request)
  if (!installer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { jobId, itemId, templateId, state, notes, photoUrl, photoPath } = await request.json()
  const service = await createServiceClient()
  const { data: job } = await service.from('jobs').select('company_id').eq('id', jobId).single()
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const { data: existing } = await service.from('qa_submissions').select('id')
    .eq('job_id', jobId).eq('user_id', installer.userId).eq('checklist_item_id', itemId).maybeSingle()

  if (existing) {
    await service.from('qa_submissions').update({
      state, notes, template_id: templateId,
      photo_url: photoUrl || null, photo_path: photoPath || null,
      submitted_at: new Date().toISOString()
    }).eq('id', existing.id)
  } else {
    await service.from('qa_submissions').insert({
      job_id: jobId, user_id: installer.userId, company_id: job.company_id,
      checklist_item_id: itemId, template_id: templateId,
      state, notes, photo_url: photoUrl || null, photo_path: photoPath || null
    })
  }

  return NextResponse.json({ success: true })
}
