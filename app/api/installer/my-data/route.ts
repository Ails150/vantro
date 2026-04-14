import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifyInstallerToken } from '@/lib/auth'

export async function GET(request: Request) {
  const installer = verifyInstallerToken(request)
  if (!installer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = await createServiceClient()

  // Gather all data for this user
  const [userData, signins, locationLogs, diaryEntries, qaSubmissions, defects] = await Promise.all([
    service.from('users').select('name, email, role, created_at, gps_tracking_acknowledged, gps_tracking_acknowledged_at').eq('id', installer.userId).single(),
    service.from('signins').select('*, jobs(name, address)').eq('user_id', installer.userId).order('signed_in_at', { ascending: false }).limit(500),
    service.from('location_logs').select('lat, lng, accuracy_metres, distance_from_site_metres, within_range, logged_at').eq('user_id', installer.userId).order('logged_at', { ascending: false }).limit(2000),
    service.from('diary_entries').select('entry_text, created_at, jobs(name)').eq('user_id', installer.userId).order('created_at', { ascending: false }).limit(200),
    service.from('qa_submissions').select('state, notes, created_at, checklist_items(label)').eq('user_id', installer.userId).order('created_at', { ascending: false }).limit(500),
    service.from('defects').select('description, severity, created_at, jobs(name)').eq('reported_by', installer.userId).order('created_at', { ascending: false }).limit(200),
  ])

  return NextResponse.json({
    exported_at: new Date().toISOString(),
    user: userData.data,
    signins: signins.data || [],
    location_logs: locationLogs.data || [],
    diary_entries: diaryEntries.data || [],
    qa_submissions: qaSubmissions.data || [],
    defects: defects.data || [],
  })
}