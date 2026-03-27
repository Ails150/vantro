import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const service = await createServiceClient()
  const { data: userData } = await service.from('users').select('company_id, role').eq('auth_user_id', user.id).single()
  if (!userData || userData.role !== 'admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { signinId, signed_in_at, signed_out_at } = await request.json()

  const { error } = await service.from('signins')
    .update({ signed_in_at, signed_out_at })
    .eq('id', signinId)
    .eq('company_id', userData.company_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
