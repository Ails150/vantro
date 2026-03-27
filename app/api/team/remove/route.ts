import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const service = await createServiceClient()
  const { authUserId, userId } = await request.json()
  await service.from('team_members').delete().eq('id', userId)
  if (authUserId) await service.auth.admin.deleteUser(authUserId)
  return NextResponse.json({ success: true })
}
