import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getCallerContext, isDashboardRole } from '@/lib/company-context'

export async function GET(request: Request) {
  const ctx = await getCallerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Every worker's hours and sign-ins for the company. Not for a field session.
  if (!isDashboardRole(ctx.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!ctx.companyId) return NextResponse.json({ error: 'No company selected' }, { status: 400 })
  const service = await createServiceClient()
  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  if (!from || !to) return NextResponse.json({ error: 'Missing dates' }, { status: 400 })
  const { data: signins } = await service
    .from('signins')
    .select('*, users(id, name, initials, email, sign_in_time), jobs(name, start_time)')
    .eq('company_id', ctx.companyId)
    .gte('signed_in_at', from)
    .lte('signed_in_at', to)
    .not('signed_out_at', 'is', null)
    .order('signed_in_at', { ascending: true })
  return NextResponse.json({ signins: signins || [] })
}
