import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const service = await createServiceClient()
  const { data: userData } = await service.from('users').select('company_id').eq('auth_user_id', user.id).single()
  if (!userData) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  if (!from || !to) return NextResponse.json({ error: 'Missing dates' }, { status: 400 })
  const { data: signins } = await service
    .from('signins')
    .select('*, users(id, name, initials, email), jobs(name)')
    .eq('company_id', userData.company_id)
    .gte('signed_in_at', from)
    .lte('signed_in_at', to)
    .not('signed_out_at', 'is', null)
    .order('signed_in_at', { ascending: true })
  return NextResponse.json({ signins: signins || [] })
}
