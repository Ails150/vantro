import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

function getInstallerFromToken(request: Request) {
  const auth = request.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return null
  try {
    const payload = JSON.parse(Buffer.from(auth.slice(7), 'base64').toString())
    // exp may be in seconds (JWT standard) or milliseconds - handle both
    const expMs = payload.exp < 10_000_000_000 ? payload.exp * 1000 : payload.exp
    if (expMs < Date.now()) return null
    return payload
  } catch { return null }
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)))
}

export async function POST(request: Request) {
  const installer = getInstallerFromToken(request)
  if (!installer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { lat, lng, accuracy } = await request.json()
  if (!lat || !lng) return NextResponse.json({ error: 'Missing coordinates' }, { status: 400 })

  const service = await createServiceClient()
  const today = new Date(); today.setHours(0,0,0,0)

  const { data: signin, error: signinErr } = await service.from('signins')
    .select('id, job_id, jobs(lat, lng)')
    .eq('user_id', installer.userId)
    .gte('signed_in_at', today.toISOString())
    .is('signed_out_at', null)
    .maybeSingle()

  if (signinErr) {
    console.error('[location] signin lookup failed', signinErr)
    return NextResponse.json({ error: 'Signin lookup failed', detail: signinErr.message }, { status: 500 })
  }
  if (!signin) return NextResponse.json({ error: 'Not signed in' }, { status: 400 })

  const { data: me } = await service.from('users').select('company_id').eq('id', installer.userId).single()
  if (!me?.company_id) return NextResponse.json({ error: 'No company' }, { status: 400 })

  const job = signin.jobs as any
  let distanceFromSite = 0
  let withinRange = true

  if (job?.lat && job?.lng) {
    distanceFromSite = haversine(lat, lng, job.lat, job.lng)
    withinRange = distanceFromSite <= 150
  }

  const { error: insertErr } = await service.from('location_logs').insert({
    signin_id: signin.id,
    user_id: installer.userId,
    company_id: me.company_id,
    job_id: signin.job_id,
    lat, lng,
    accuracy_metres: accuracy ? Math.round(accuracy) : null,
    distance_from_site_metres: distanceFromSite,
    within_range: withinRange,
  })

  if (insertErr) {
    console.error('[location] insert failed', insertErr)
    return NextResponse.json({ error: 'Insert failed', detail: insertErr.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, distanceFromSite, withinRange })
}