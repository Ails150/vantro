import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const path = searchParams.get('path')
  if (!path) return NextResponse.json({ error: 'Missing path' }, { status: 400 })

  const service = await createServiceClient()
  const { data, error } = await service.storage.from('vantro-media').createSignedUrl(path, 3600)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ url: data.signedUrl })
}
