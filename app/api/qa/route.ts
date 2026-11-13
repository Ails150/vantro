import { verifyActiveFieldToken } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { assertJobBelongsToCaller } from '@/lib/tenant'
import { isUuid, ownedId } from '@/lib/ownership'
import { isCompanyKey } from '@/lib/upload-key'

const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

export async function GET(request: Request) {
  const installer = await verifyActiveFieldToken(request)
  if (!installer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = new URL(request.url)
  const jobId = searchParams.get('jobId')
  if (!jobId) return NextResponse.json({ error: 'Missing jobId' }, { status: 400 })

  // The job must be the caller's before its checklists or submissions are read.
  const owned = await assertJobBelongsToCaller(jobId, installer.companyId)
  if (!owned.ok) return notFound()
  const ownedJobId: string = owned.job.id

  const service = await createServiceClient()

  const { data: jobChecklists } = await service
    .from('job_checklists')
    .select('template_id, checklist_templates(id, name, requires_approval, audit_only, checklist_items(*))')
    .eq('job_id', ownedJobId)

  if (!jobChecklists?.length) return NextResponse.json({ checklists: [], items: [], submissions: [] })

  const { data: submissions } = await service
    .from('qa_submissions')
    .select('*')
    .eq('job_id', ownedJobId)
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
  const installer = await verifyActiveFieldToken(request)
  if (!installer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { jobId, itemId, templateId, state, notes, photoUrl, photoPath, videoUrl, videoPath, remedialAction } = await request.json()
  const service = await createServiceClient()
  const owned = await assertJobBelongsToCaller<{ id: string; company_id: string }>(jobId, installer.companyId)
  if (!owned.ok) return owned.response
  const job = owned.job
  const ownedJobId = job.id

  // The template must be this company's and the item must be on it. Not
  // narrowed to job_checklists: the field app's checklist library
  // (/api/installer/checklists/library) offers every company template, not
  // only those assigned to the job.
  const ownedTemplateId = await ownedId(service, 'checklist_templates', templateId, installer.companyId)
  if (!ownedTemplateId) return notFound()
  // Item checked through its (verified) template rather than its own
  // company_id, which older rows may not carry.
  if (!isUuid(itemId)) return notFound()
  const { data: itemRow } = await service.from('checklist_items').select('id, template_id')
    .eq('id', itemId).eq('template_id', ownedTemplateId).maybeSingle()
  if (!itemRow || (itemRow as any).id !== itemId || (itemRow as any).template_id !== ownedTemplateId) return notFound()
  const ownedItemId: string = (itemRow as any).id

  // A photo path is stored and later signed for viewing, so it must be a key
  // this company was issued. Not rejected: the mobile offline queue replays old
  // payloads and a 4xx would leave them retrying forever. The submission is
  // kept and the path dropped. videoPath is a Cloudflare Stream uid, not a key.
  let safePhotoPath: string | null = photoPath || null
  if (safePhotoPath && !isCompanyKey(safePhotoPath, installer.companyId)) {
    console.warn('[api/qa POST] dropped photoPath outside company prefix', { userId: installer.userId, jobId: ownedJobId })
    safePhotoPath = null
  }

  const { data: existing } = await service.from('qa_submissions').select('id')
    .eq('job_id', ownedJobId).eq('user_id', installer.userId).eq('checklist_item_id', ownedItemId).maybeSingle()

  // Sign-off: the installer's own initials + today's date are captured automatically.
  const { data: me } = await service.from('users').select('initials').eq('id', installer.userId).maybeSingle()
  const today = new Date().toISOString().slice(0, 10)
  const signoff: any = {
    installer_initials: me?.initials || null,
    installer_date: today,
  }
  if (remedialAction !== undefined) signoff.remedial_action = remedialAction || null

  const base: any = existing
    ? { state, notes, template_id: ownedTemplateId, photo_url: photoUrl || null, photo_path: safePhotoPath, video_url: videoUrl || null, video_path: videoPath || null, submitted_at: new Date().toISOString() }
    : { job_id: ownedJobId, user_id: installer.userId, company_id: job.company_id, checklist_item_id: ownedItemId, template_id: ownedTemplateId, state, notes, photo_url: photoUrl || null, photo_path: safePhotoPath, video_url: videoUrl || null, video_path: videoPath || null }

  const run = (payload: any) => existing
    ? service.from('qa_submissions').update(payload).eq('id', existing.id)
    : service.from('qa_submissions').insert(payload)

  let { error } = await run({ ...base, ...signoff })
  // If the sign-off columns aren't migrated yet, still save the core submission.
  if (error && /installer_initials|installer_date|remedial_action/.test(`${error.message || ''} ${error.details || ''} ${error.hint || ''}`)) {
    ;({ error } = await run(base))
  }

  if (error) {
    console.error('[api/qa POST] save failed:', error)
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}
