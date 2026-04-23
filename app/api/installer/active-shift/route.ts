import { verifyInstallerToken } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const installer = verifyInstallerToken(request)
  if (!installer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = await createServiceClient()

  // Find the most recent open signin for this installer (any date)
  const { data: signin, error } = await service
    .from('signins')
    .select('id, job_id, signed_in_at, expected_sign_out_time, company_id, jobs(name, lat, lng)')
    .eq('user_id', installer.userId)
    .is('signed_out_at', null)
    .order('signed_in_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!signin) {
    return NextResponse.json({ activeShift: null })
  }

  const job = signin.jobs as any

  return NextResponse.json({
    activeShift: {
      signinId: signin.id,
      jobId: signin.job_id,
      jobName: job?.name || null,
      jobLat: job?.lat || null,
      jobLng: job?.lng || null,
      signedInAt: signin.signed_in_at,
      expectedSignOutTime: signin.expected_sign_out_time,
      companyId: signin.company_id,
    }
  })
}