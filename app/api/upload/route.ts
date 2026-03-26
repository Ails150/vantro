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

export async function POST(request: Request) {
  const installer = getInstallerFromToken(request)
  if (!installer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await request.formData()
  const file = formData.get('file') as File
  const jobId = formData.get('jobId') as string
  const itemId = formData.get('itemId') as string

  if (!file || !jobId) return NextResponse.json({ error: 'Missing file or jobId' }, { status: 400 })

  const service = await createServiceClient()
  const { data: job } = await service.from('jobs').select('company_id').eq('id', jobId).single()
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const ext = file.name.split('.').pop() || 'jpg'
  const filename = `${job.company_id}/${jobId}/${itemId || 'diary'}/${Date.now()}.${ext}`

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  const { data, error } = await service.storage
    .from('vantro-media')
    .upload(filename, buffer, {
      contentType: file.type,
      upsert: false
    })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  const { data: urlData } = service.storage.from('vantro-media').getPublicUrl(filename)

  return NextResponse.json({ url: urlData.publicUrl, path: filename })
}
