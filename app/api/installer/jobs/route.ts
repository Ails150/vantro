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

export async function GET(request: Request) {
  const installer = getInstallerFromToken(request)
  if (!installer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = await createServiceClient()

  // Get jobs assigned to this installer
  const { data: assignments } = await service
    .from('job_assignments')
    .select('job_id')
    .eq('user_id', installer.userId)

  if (!assignments?.length) {
    const { data: companyUser } = await service.from("users").select("company_id").eq("id", installer.userId).single()
    if (!companyUser?.company_id) return NextResponse.json({ jobs: [] })
    const { data: allJobs } = await service.from("jobs").select("*").eq("company_id", companyUser.company_id).eq("status", "active")
    return NextResponse.json({ jobs: allJobs || [] })
  }

  const jobIds = assignments.map((a: any) => a.job_id)

  const { data: jobs } = await service
    .from('jobs')
    .select('*')
    .in('id', jobIds)
    .eq('status', 'active')

  // Check which jobs this installer is signed into today
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const { data: signins } = await service
    .from('signins')
    .select('job_id')
    .eq('user_id', installer.userId)
    .gte('signed_in_at', today.toISOString())
    .is('signed_out_at', null)

  const signedInJobIds = new Set(signins?.map((s: any) => s.job_id) || [])

  const jobsWithStatus = (jobs || []).map((j: any) => ({
    ...j,
    signed_in: signedInJobIds.has(j.id)
  }))

  return NextResponse.json({ jobs: jobsWithStatus })
}
