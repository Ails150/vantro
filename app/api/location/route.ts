import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifyInstallerToken } from '@/lib/auth'

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

  const { lat, lng, accuracy } = await request.json()
  if (!lat || !lng) return NextResponse.json({ error: 'Missing coordinates' }, { status: 400 })

  const service = await createServiceClient()
  const today = new Date(); today.setHours(0,0,0,0)

  const { data: signin } = await service.from('signins')
    .select('id, job_id, jobs(lat, lng)')
    .eq('user_id', installer.userId)
    .gte('signed_in_at', today.toISOString())
    .is('signed_out_at', null)
    .maybeSingle()

  if (!signin) return NextResponse.json({ error: 'Not signed in' }, { status: 400 })

  const { data: me } = await service.from('users').select('company_id').eq('id', installer.userId).single()
  if (!me?.company_id) return NextResponse.json({ error: 'No company' }, { status: 400 })

  // timeoff_guard_location
  // Skip GPS log if installer is on approved time off today.
  // Also skip if their company is observing a public holiday today.
  try {
    const todayStr = new Date().toISOString().slice(0, 10)
    const { data: tOff } = await service
      .from('time_off_entries')
      .select('id')
      .eq('user_id', installer.userId)
      .eq('status', 'approved')
      .lte('start_date', todayStr)
      .gte('end_date', todayStr)
      .limit(1)
    if (tOff && tOff.length > 0) {
      return NextResponse.json({ success: true, skipped: 'time_off' })
    }
    const { data: cmp } = await service
      .from('companies')
      .select('country_code')
      .eq('id', me.company_id)
      .single()
    if (cmp?.country_code) {
      const { data: ph } = await service
        .from('public_holidays')
        .select('id')
        .eq('country_code', cmp.country_code)
        .eq('holiday_date', todayStr)
        .limit(1)
      if (ph && ph.length > 0) {
        return NextResponse.json({ success: true, skipped: 'public_holiday' })
      }
    }
  } catch (err) {
    console.error('[location] timeoff guard check failed', err)
    // fall through and log GPS as normal
  }

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