import { verifyInstallerToken } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

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

  // Generate signed URLs for photos
  const defectsWithSignedUrls = await Promise.all((data || []).map(async (defect: any) => {
    if (defect.photo_path) {
      const { data: signedData } = await service.storage.from('vantro-media').createSignedUrl(defect.photo_path, 3600)
      return { ...defect, photo_url: signedData?.signedUrl || defect.photo_url }
    }
    return defect
  }))

  return NextResponse.json({ defects: defectsWithSignedUrls })
}

export async function POST(request: Request) {
  const service = await createServiceClient()
  const auth = request.headers.get('authorization')

  // Check if installer token or admin session
  let userId, companyId
  if (auth?.startsWith('Bearer ')) {
    const installer = verifyInstallerToken(request)
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

    // For critical/major defects: create alert + push admin/foreman
    const sev = severity || 'minor'
    if (sev === 'critical' || sev === 'major') {
      try {
        const { data: job } = await service.from('jobs').select('name').eq('id', jobId).single()
        const { data: installer } = await service.from('users').select('name').eq('id', userId).single()
        const alertMessage = (sev === 'critical' ? 'CRITICAL defect' : 'Major defect') + ' at ' + (job?.name || 'site') + ': ' + description.slice(0, 200)

        await service.from('alerts').insert({
          company_id: companyId,
          user_id: userId,
          job_id: jobId,
          alert_type: sev === 'critical' ? 'blocker' : 'issue',
          message: alertMessage,
          is_read: false,
          status: 'open',
        })

        const { data: admins } = await service.from('users')
          .select('push_token')
          .eq('company_id', companyId)
          .in('role', ['admin', 'foreman'])
        const adminTokens = (admins || []).map((a: any) => a.push_token).filter(Boolean)
        if (adminTokens.length > 0) {
          await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(adminTokens.map((t: string) => ({
              to: t,
              sound: 'default',
              title: sev === 'critical' ? 'CRITICAL defect logged' : 'Major defect logged',
              body: (installer?.name || 'Installer') + ' at ' + (job?.name || 'site') + ': ' + description.slice(0, 100),
              data: { type: 'defect_alert', defectId: data.id, jobId },
              channelId: 'vantro',
            }))),
          }).catch(() => {})
        }
      } catch (alertErr) {
        console.error('[defects] alert/push failed (non-fatal)', alertErr)
      }
    }

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
