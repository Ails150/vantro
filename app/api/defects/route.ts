import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

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
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const service = await createServiceClient()
  const { data: userData } = await service.from('users').select('company_id').eq('auth_user_id', user.id).single()
  if (!userData) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { searchParams } = new URL(request.url)
  const jobId = searchParams.get('jobId')

  let query = service.from('defects').select('*, jobs(name), users(name, initials)').eq('company_id', userData.company_id).order('created_at', { ascending: false })
  if (jobId) query = query.eq('job_id', jobId)

  const { data } = await query
  return NextResponse.json({ defects: data || [] })
}

export async function POST(request: Request) {
  const service = await createServiceClient()
  const auth = request.headers.get('authorization')

  // Check if installer token or admin session
  let userId, companyId
  if (auth?.startsWith('Bearer ')) {
    const installer = getInstallerFromToken(request)
    if (!installer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    userId = installer.userId
    const { data: u } = await service.from('users').select('company_id').eq('id', userId).single()
    companyId = u?.company_id
  } else {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { data: u } = await service.from('users').select('id, company_id').eq('auth_user_id', user.id).single()
    userId = u?.id
    companyId = u?.company_id
  }

  const body = await request.json()
  const { action, jobId, description, severity, photoUrl, photoPath, defectId, resolutionNote } = body

  if (action === 'create') {
    const { data, error } = await service.from('defects').insert({
      job_id: jobId, user_id: userId, company_id: companyId,
      description, severity: severity || 'minor',
      photo_url: photoUrl || null, photo_path: photoPath || null
    }).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ defect: data })
  }

  if (action === 'resolve') {
    const { error } = await service.from('defects').update({
      status: 'resolved', resolution_note: resolutionNote,
      resolved_by: userId, resolved_at: new Date().toISOString()
    }).eq('id', defectId)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true })
  }

  if (action === 'reopen') {
    const { error } = await service.from('defects').update({
      status: 'open', resolution_note: null, resolved_by: null, resolved_at: null
    }).eq('id', defectId)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
