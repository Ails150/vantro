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

  // Get job location for distance check
  const { data: job } = await service.from('jobs').select('lat, lng, name, company_id').eq('id', jobId).single()
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  // Get company geofence radius (default 150m)
  const { data: company } = await service.from('companies').select('geofence_radius_metres').eq('id', job.company_id).single()
  const radius = company?.geofence_radius_metres || 150

  let distanceMetres = 0
  let withinRange = true

  if (job.lat && job.lng && lat && lng) {
    distanceMetres = haversine(lat, lng, job.lat, job.lng)
    withinRange = distanceMetres <= radius

    if (!withinRange) {
      return NextResponse.json({
        error: `You are ${distanceMetres}m from ${job.name}. You must be within ${radius}m to sign out.`,
        distanceMetres,
        withinRange: false
      }, { status: 400 })
    }
  }

  const today = new Date(); today.setHours(0,0,0,0)
  const now = new Date()

  // Find the active signin
  const { data: signin } = await service.from('signins')
    .select('id, signed_in_at, expected_sign_out_time')
    .eq('job_id', jobId)
    .eq('user_id', installer.userId)
    .gte('signed_in_at', today.toISOString())
    .is('signed_out_at', null)
    .maybeSingle()

  if (!signin) return NextResponse.json({ error: 'No active sign-in found' }, { status: 400 })

  // Calculate hours worked
  const signedInAt = new Date(signin.signed_in_at)
  const hoursWorked = Math.round(((now.getTime() - signedInAt.getTime()) / 3600000) * 100) / 100

  // Check for early departure
  let departedEarly = false
  let earlyDepartureMinutes = 0

  if (signin.expected_sign_out_time) {
    const [eh, em] = signin.expected_sign_out_time.split(':').map(Number)
    const expectedMinutes = eh * 60 + em
    const nowUkHour = (now.getUTCHours() + 1) % 24 // BST
    const nowMinutes = nowUkHour * 60 + now.getUTCMinutes()
    if (nowMinutes < expectedMinutes - 5) { // 5 min grace for early
      departedEarly = true
      earlyDepartureMinutes = expectedMinutes - nowMinutes
    }
  }

  const updateData: any = {
    signed_out_at: now.toISOString(),
    sign_out_lat: lat || null,
    sign_out_lng: lng || null,
    sign_out_accuracy_metres: accuracy ? Math.round(accuracy) : null,
    sign_out_distance_metres: distanceMetres,
    sign_out_within_range: withinRange,
    hours_worked: hoursWorked,
    departed_early: departedEarly,
    early_departure_minutes: earlyDepartureMinutes > 0 ? earlyDepartureMinutes : null,
  }

  if (departedEarly) {
    updateData.flagged = true
    updateData.flag_reason = `Left ${Math.floor(earlyDepartureMinutes / 60)}h ${earlyDepartureMinutes % 60}m early`
  }

  const { error } = await service
    .from('signins')
    .update(updateData)
    .eq('id', signin.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true, distanceMetres, withinRange, hoursWorked, departedEarly, earlyDepartureMinutes })
}