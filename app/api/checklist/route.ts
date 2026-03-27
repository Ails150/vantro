import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const service = await createServiceClient()
  const { data: userData } = await service.from('users').select('company_id').eq('auth_user_id', user.id).single()
  if (!userData) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { data: templates } = await service.from('checklist_templates').select('*, checklist_items(*)').eq('company_id', userData.company_id).order('created_at', { ascending: false })
  return NextResponse.json({ templates: templates || [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const service = await createServiceClient()
  const { data: userData } = await service.from('users').select('company_id').eq('auth_user_id', user.id).single()
  if (!userData) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = await request.json()
  const { action } = body

  if (action === 'create_template') {
    const { name } = body
    const { data, error } = await service.from('checklist_templates').insert({ name, company_id: userData.company_id }).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ template: data })
  }

  if (action === 'add_item') {
    const { templateId, label, item_type, is_mandatory, requires_photo, requires_video, fail_note_required, sort_order } = body
    const { data, error } = await service.from('checklist_items').insert({
      template_id: templateId,
      company_id: userData.company_id,
      label, item_type,
      is_mandatory: is_mandatory || false,
      requires_photo: requires_photo || false,
      requires_video: requires_video || false,
      fail_note_required: fail_note_required || false,
      sort_order: sort_order || 0
    }).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ item: data })
  }

  if (action === 'delete_item') {
    const { itemId } = body
    console.log('Deleting item:', itemId)
    const { error, count } = await service.from('checklist_items').delete({ count: 'exact' }).eq('id', itemId)
    console.log('Delete result:', { error, count })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true, deleted: count })
  }

  if (action === 'delete_template') {
    const { templateId } = body
    await service.from('checklist_items').delete().eq('template_id', templateId)
    await service.from('checklist_templates').delete().eq('id', templateId)
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

