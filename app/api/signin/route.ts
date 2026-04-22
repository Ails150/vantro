import { verifyInstallerToken } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)))
}

export async function POST(request: Request) {
  const installer = verifyInstallerToken(request)
  if (!installer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { jobId, lat, lng, accuracy } = await request.json()
  const service = await createServiceClient()

  const { data: job } = await service.from('jobs').select('lat, lng, company_id, name, sign_out_time').eq('id', jobId).single()
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const { data: company } = await service.from('companies')
    .select('geofence_radius_metres, default_sign_out_time')
    .eq('id', job.company_id).single()

  const radius = company?.geofence_radius_metres || 150
  let distanceMetres = 0
  let withinRange = true

  if (job.lat && job.lng) {
    distanceMetres = Math.round(haversine(lat, lng, job.lat, job.lng))
    withinRange = distanceMetres <= radius

    if (!withinRange) {
      return NextResponse.json({
        error: `You are ${distanceMetres}m from ${job.name}. You must be within ${radius}m to sign in.`,
        distanceMetres,
        withinRange: false
      }, { status: 400 })
    }
  }

  const today = new Date(); today.setHours(0,0,0,0)
  const { data: existing } = await service.from('signins')
    .select('id, job_id, jobs(name)')
    .eq('user_id', installer.userId)
    .gte('signed_in_at', today.toISOString())
    .is('signed_out_at', null)
    .limit(1)
    .maybeSingle()

  if (existing) {
    if (existing.job_id === jobId) {
      return NextResponse.json({ success: true, distanceMetres, withinRange, alreadySignedIn: true })
    }
    const otherJobName = (existing.jobs as any)?.name || 'another job'
    return NextResponse.json({ error: `You are already signed in to ${otherJobName}. Sign out first.` }, { status: 400 })
  }

  const expectedSignOutTime = job.sign_out_time || company?.default_sign_out_time || null

  const { error } = await service.from('signins').insert({
    job_id: jobId,
    user_id: installer.userId,
    company_id: job.company_id,
    lat, lng,
    accuracy_metres: accuracy,
    distance_from_site_metres: distanceMetres,
    within_range: withinRange,
    expected_sign_out_time: expectedSignOutTime,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  const { data: installerUser } = await service.from('users').select('weekly_schedule').eq('id', installer.userId).single()
  return NextResponse.json({ success: true, distanceMetres, withinRange, weeklySchedule: installerUser?.weekly_schedule || null })
}