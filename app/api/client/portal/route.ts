import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import jwt from "jsonwebtoken"
import { JWT_SECRET } from "@/lib/auth"


export async function GET(request: Request) {
  const auth = request.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const payload = jwt.verify(auth.replace('Bearer ', ''), JWT_SECRET) as any
    if (payload.type !== 'client') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const service = await createServiceClient()
    const { jobId, companyId } = payload

    // Second, independent check. The token is signed, but a forged or stale one
    // must not be enough on its own: the job it names has to belong to the
    // company the token claims. Neither a bad token nor a bad invite leaks by
    // itself.
    const { data: jobRow } = await service
      .from('jobs')
      .select('id, name, address, status, company_id')
      .eq('id', jobId)
      .single()
    if (!jobRow || !companyId || jobRow.company_id !== companyId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const [{ data: diary }, { data: signins }, { data: qa }] = await Promise.all([
      service.from('diary_entries').select('id, entry_text, ai_alert_type, ai_summary, photo_urls, created_at, users(name)').eq('job_id', jobId).order('created_at', { ascending: false }).limit(50),
      service.from('signins').select('signed_in_at, signed_out_at, users(name)').eq('job_id', jobId).order('signed_in_at', { ascending: false }).limit(50),
      service.from('checklist_responses').select('created_at, result, checklist_items(label), users(name)').eq('job_id', jobId).order('created_at', { ascending: false }).limit(100)
    ])

    const { company_id: _hidden, ...job } = jobRow
    return NextResponse.json({ job, diary: diary || [], signins: signins || [], qa: qa || [] })
  } catch (e) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}