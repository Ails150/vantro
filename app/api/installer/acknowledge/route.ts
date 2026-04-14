import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifyInstallerToken } from '@/lib/auth'

export async function POST(request: Request) {
  const installer = verifyInstallerToken(request)
  if (!installer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = await createServiceClient()
  const { error } = await service.from('users').update({
    gps_tracking_acknowledged: true,
    gps_tracking_acknowledged_at: new Date().toISOString(),
    privacy_policy_version: '1.0',
  }).eq('id', installer.userId)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Log to audit trail
  await service.from('audit_log').insert({
    company_id: installer.companyId,
    user_id: installer.userId,
    action: 'gps_tracking_acknowledged',
    entity_type: 'user',
    entity_id: installer.userId,
    details: { version: '1.0', acknowledged_at: new Date().toISOString() },
  })

  return NextResponse.json({ success: true })
}