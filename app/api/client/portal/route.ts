import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import jwt from "jsonwebtoken"

const JWT_SECRET = process.env.JWT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'fallback'

export async function GET(request: Request) {
  const auth = request.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const payload = jwt.verify(auth.replace('Bearer ', ''), JWT_SECRET) as any
    if (payload.type !== 'client') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const service = await createServiceClient()
    const { jobId, companyId } = payload

    const [{ data: job }, { data: diary }, { data: signins }, { data: qa }] = await Promise.all([
      service.from('jobs').select('id, name, address, status').eq('id', jobId).single(),
      service.from('diary_entries').select('id, entry_text, ai_alert_type, ai_summary, photo_urls, created_at, users(name)').eq('job_id', jobId).order('created_at', { ascending: false }).limit(50),
      service.from('signins').select('signed_in_at, signed_out_at, users(name)').eq('job_id', jobId).order('signed_in_at', { ascending: false }).limit(50),
      service.from('checklist_responses').select('created_at, result, checklist_items(label), users(name)').eq('job_id', jobId).order('created_at', { ascending: false }).limit(100)
    ])

    return NextResponse.json({ job, diary: diary || [], signins: signins || [], qa: qa || [] })
  } catch (e) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}