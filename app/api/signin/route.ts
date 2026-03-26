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

function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

export async function POST(request: Request) {
  const installer = getInstallerFromToken(request)
  if (!installer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { jobId, lat, lng, accuracy } = await request.json()
  const service = await createServiceClient()

  const { data: job } = await service.from('jobs').select('lat, lng, company_id, name').eq('id', jobId).single()
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  let distanceMetres = 0
  let withinRange = true

  if (job.lat && job.lng) {
    distanceMetres = Math.round(haversine(lat, lng, job.lat, job.lng))
    withinRange = distanceMetres <= 150

    if (!withinRange) {
      return NextResponse.json({
        error: `You are ${distanceMetres}m from ${job.name}. You must be within 150m to sign in.`,
        distanceMetres,
        withinRange: false
      }, { status: 400 })
    }
  }

  // Check already signed in today
  const today = new Date(); today.setHours(0,0,0,0)
  const { data: existing } = await service.from('signins')
    .select('id')
    .eq('job_id', jobId)
    .eq('user_id', installer.userId)
    .gte('signed_in_at', today.toISOString())
    .is('signed_out_at', null)
    .single()
  
  if (existing) return NextResponse.json({ success: true, distanceMetres, withinRange, alreadySignedIn: true })

  const { error } = await service.from('signins').insert({
    job_id: jobId,
    user_id: installer.userId,
    company_id: job.company_id,
    lat, lng,
    accuracy_metres: accuracy,
    distance_from_site_metres: distanceMetres,
    within_range: withinRange,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ success: true, distanceMetres, withinRange })
}
