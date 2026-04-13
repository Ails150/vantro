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
  const { searchParams } = new URL(request.url)
  const jobId = searchParams.get('jobId')
  if (!jobId) return NextResponse.json({ error: 'Missing jobId' }, { status: 400 })

  const service = await createServiceClient()

  const { data: jobChecklists } = await service
    .from('job_checklists')
    .select('template_id, checklist_templates(id, name, checklist_items(*))')
    .eq('job_id', jobId)

  if (!jobChecklists?.length) return NextResponse.json({ items: [], submissions: [] })

  const allItems: any[] = []
  jobChecklists.forEach((jc: any) => {
    const template = jc.checklist_templates
    if (template?.checklist_items) {
      template.checklist_items
        .sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
        .forEach((item: any) => allItems.push({ ...item, template_name: template.name }))
    }
  })

  const { data: submissions } = await service
    .from('qa_submissions')
    .select('*')
    .eq('job_id', jobId)
    .eq('user_id', installer.userId)

  return NextResponse.json({ items: allItems, submissions: submissions || [] })
}

export async function POST(request: Request) {
  const installer = getInstallerFromToken(request)
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


