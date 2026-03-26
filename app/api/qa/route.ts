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
  const { data: job } = await service.from('jobs').select('checklist_template_id').eq('id', jobId).single()
  if (!job?.checklist_template_id) return NextResponse.json({ items: [] })

  const { data: items } = await service.from('checklist_items').select('*').eq('template_id', job.checklist_template_id).order('sort_order')
  const { data: submissions } = await service.from('qa_submissions').select('*').eq('job_id', jobId).eq('user_id', installer.userId)

  return NextResponse.json({ items: items || [], submissions: submissions || [] })
}

export async function POST(request: Request) {
  const installer = getInstallerFromToken(request)
  if (!installer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { jobId, itemId, state, notes, photoUrl, photoPath } = await request.json()
  const service = await createServiceClient()
  const { data: job } = await service.from('jobs').select('company_id').eq('id', jobId).single()
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const { data: existing } = await service.from('qa_submissions').select('id').eq('job_id', jobId).eq('user_id', installer.userId).eq('checklist_item_id', itemId).single()

  if (existing) {
    await service.from('qa_submissions').update({ state, notes, photo_url: photoUrl || null, photo_path: photoPath || null, submitted_at: new Date().toISOString() }).eq('id', existing.id)
  } else {
    await service.from('qa_submissions').insert({ job_id: jobId, user_id: installer.userId, company_id: job.company_id, checklist_item_id: itemId, state, notes, photo_url: photoUrl || null, photo_path: photoPath || null })
  }

  return NextResponse.json({ success: true })
}
