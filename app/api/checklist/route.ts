import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getCallerContext, isDashboardRole } from '@/lib/company-context'
import { ownedId } from '@/lib/ownership'

// Checklist templates, their items, and which jobs use them.
//
// Every id in a request is checked against the caller's company before it is
// used. This route runs on the service role, so nothing else stops one company
// editing or deleting another company's templates, items, or the QA
// submissions recorded against them -- which is exactly what it allowed until
// this check went in, to any signed-in user of any role.

const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

async function caller() {
  const ctx = await getCallerContext()
  if (!ctx) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!isDashboardRole(ctx.role) || !ctx.companyId) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { companyId: ctx.companyId, service: await createServiceClient() }
}

export async function GET() {
  const c = await caller()
  if ('error' in c) return c.error
  const { data: templates } = await c.service.from('checklist_templates').select('*, checklist_items(*)').eq('company_id', c.companyId).order('created_at', { ascending: false })
  return NextResponse.json({ templates: templates || [] })
}

export async function POST(request: Request) {
  const c = await caller()
  if ('error' in c) return c.error
  const { service, companyId } = c
  const body = await request.json().catch(() => ({}))
  const { action } = body || {}

  const template = (id: unknown) => ownedId(service, 'checklist_templates', id, companyId)
  const job = (id: unknown) => ownedId(service, 'jobs', id, companyId)

  if (action === 'create_template') {
    const { name, frequency } = body
    const { data, error } = await service.from('checklist_templates').insert({ name, company_id: companyId, frequency: frequency || 'job' }).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ template: data })
  }

  if (action === 'add_item') {
    const { label, item_type, is_mandatory, requires_photo, requires_video, fail_note_required, sort_order, trade } = body
    const templateId = await template(body.templateId)
    if (!templateId) return notFound()
    const { data, error } = await service.from('checklist_items').insert({
      template_id: templateId,
      company_id: companyId,
      label, item_type,
      is_mandatory: is_mandatory || false,
      requires_photo: requires_photo || false,
      requires_video: requires_video || false,
      fail_note_required: fail_note_required || false,
      sort_order: sort_order || 0,
      trade: trade || null
    }).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ item: data })
  }

  if (action === 'delete_item') {
    const itemId = await ownedId(service, 'checklist_items', body.itemId, companyId)
    if (!itemId) return notFound()
    await service.from('qa_submissions').delete().eq('checklist_item_id', itemId).eq('company_id', companyId)
    const { error } = await service.from('checklist_items').delete().eq('id', itemId).eq('company_id', companyId)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true })
  }

  if (action === 'assign_to_job') {
    const [jobId, templateId] = await Promise.all([job(body.jobId), template(body.templateId)])
    if (!jobId || !templateId) return notFound()
    const { error } = await service.from('job_checklists').upsert({ job_id: jobId, template_id: templateId }, { onConflict: 'job_id,template_id' })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true })
  }

  if (action === 'remove_from_job') {
    const jobId = await job(body.jobId)
    if (!jobId) return notFound()
    if (body.templateId === 'all') {
      await service.from('job_checklists').delete().eq('job_id', jobId)
    } else {
      const templateId = await template(body.templateId)
      if (!templateId) return notFound()
      const { error } = await service.from('job_checklists').delete().eq('job_id', jobId).eq('template_id', templateId)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ success: true })
  }

  if (action === 'update_template') {
    const templateId = await template(body.templateId)
    if (!templateId) return notFound()
    const { requires_approval, audit_only, name, frequency } = body
    const updateData: any = { requires_approval, audit_only }
    if (name) updateData.name = name
    if (frequency) updateData.frequency = frequency
    const { error } = await service.from('checklist_templates').update(updateData).eq('id', templateId).eq('company_id', companyId)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true })
  }

  if (action === 'delete_template') {
    const templateId = await template(body.templateId)
    if (!templateId) return notFound()
    await service.from('job_checklists').delete().eq('template_id', templateId)
    await service.from('checklist_items').delete().eq('template_id', templateId).eq('company_id', companyId)
    const { error } = await service.from('checklist_templates').delete().eq('id', templateId).eq('company_id', companyId)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true })
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
