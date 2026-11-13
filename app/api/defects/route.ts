import { verifyActiveFieldToken } from '@/lib/auth'
import { sendDiaryAlertEmail } from '@/lib/email-alerts'
import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { ownedId } from '@/lib/ownership'
import { isCompanyKey } from '@/lib/upload-key'

// A storage path is only stored if it is a key /api/upload would have issued to
// this company. GET signs these paths with the service role, so an unchecked
// path was a way to fetch any other company's photographs. A bad path is
// dropped rather than refused: the phone's offline queue replays old payloads,
// and a refusal would leave them retrying for ever.
function companyPath(path: unknown, companyId: string): string | null {
  if (typeof path !== 'string' || !path) return null
  if (isCompanyKey(path, companyId)) return path
  console.warn('[defects] dropped a storage path outside this company')
  return null
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

  // Generate signed URLs for photos
  const defectsWithSignedUrls = await Promise.all((data || []).map(async (defect: any) => {
    let updated = { ...defect }
    if (defect.photo_path) {
      const { data: signedData } = await service.storage.from('vantro-media').createSignedUrl(defect.photo_path, 3600)
      if (signedData?.signedUrl) updated.photo_url = signedData.signedUrl
    }
    if (defect.video_path) {
      const { data: vidSigned } = await service.storage.from('vantro-media').createSignedUrl(defect.video_path, 3600)
      if (vidSigned?.signedUrl) updated.video_url = vidSigned.signedUrl
    }
    return updated
  }))

  return NextResponse.json({ defects: defectsWithSignedUrls })
}

export async function POST(request: Request) {
  const service = await createServiceClient()
  const auth = request.headers.get('authorization')

  // Check if installer token or admin session
  let userId, companyId
  if (auth?.startsWith('Bearer ')) {
    const installer = await verifyActiveFieldToken(request)
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

  if (!userId || !companyId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const { action, jobId, description, severity, photoUrl, photoPath, videoUrl, videoPath, defectId, resolutionNote } = body

  if (action === 'create') {
    const ownJobId = await ownedId(service, 'jobs', jobId, companyId)
    if (!ownJobId) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const { data, error } = await service.from('defects').insert({
      job_id: ownJobId, user_id: userId, company_id: companyId,
      description, severity: severity || 'minor',
      photo_url: photoUrl || null, photo_path: companyPath(photoPath, companyId),
      video_url: videoUrl || null, video_path: companyPath(videoPath, companyId)
    }).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    // For critical/major defects: create alert + push admin/foreman
    const sev = severity || 'minor'
    if (sev === 'critical' || sev === 'major') {
      try {
        const { data: job } = await service.from('jobs').select('name').eq('id', ownJobId).single()
        const { data: installer } = await service.from('users').select('name').eq('id', userId).single()
        const alertMessage = (sev === 'critical' ? 'CRITICAL defect' : 'Major defect') + ' at ' + (job?.name || 'site') + ': ' + description.slice(0, 200)

        await service.from('alerts').insert({
          company_id: companyId,
          user_id: userId,
          job_id: ownJobId,
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
              data: { type: 'defect_alert', defectId: data.id, jobId: ownJobId },
              channelId: 'vantro',
            }))),
          }).catch(() => {})
        }

        // defect-email-2026-05-20 - email admin/foreman who have email_alert_prefs enabled
        try {
          await sendDiaryAlertEmail({
            companyId,
            jobId: ownJobId,
            alertType: sev === 'critical' ? 'blocker' : 'issue',
            summary: description,
            loggedBy: installer?.name || 'Installer',
            triggeredBy: userId,
            photoUrls: photoUrl ? [photoUrl] : [],
          })
        } catch (emailErr) {
          console.error('[defects] email failed (non-fatal)', emailErr)
        }
      } catch (alertErr) {
        console.error('[defects] alert/push failed (non-fatal)', alertErr)
      }
    }

    return NextResponse.json({ defect: data })
  }

  if (action === 'resolve') {
    const { data: resolved, error } = await service.from('defects').update({
      status: 'resolved', resolution_note: resolutionNote,
      resolved_by: userId, resolved_at: new Date().toISOString()
    }).eq('id', defectId).eq('company_id', companyId).select('id')
    if (!error && !resolved?.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true })
  }

  if (action === 'reopen') {
    const { data: reopened, error } = await service.from('defects').update({
      status: 'open', resolution_note: null, resolved_by: null, resolved_at: null
    }).eq('id', defectId).eq('company_id', companyId).select('id')
    if (!error && !reopened?.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
