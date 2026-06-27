import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const service = await createServiceClient()
  const { data: userData } = await service.from('users').select('company_id').eq('auth_user_id', user.id).single()
  if (!userData) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: approvals } = await service
    .from('qa_approvals')
    .select('*, jobs(name, address), users(name, initials)')
    .eq('company_id', userData.company_id)
    .order('submitted_at', { ascending: false })

  const results = await Promise.all((approvals || []).map(async (approval: any) => {
    // Include hold_point on the joined item; fall back if that column isn't migrated yet.
    let { data: submissions, error: subErr } = await service
      .from('qa_submissions')
      .select('*, checklist_items(label, item_type, hold_point)')
      .eq('job_id', approval.job_id)
      .eq('user_id', approval.user_id)
    if (subErr) {
      ;({ data: submissions } = await service
        .from('qa_submissions')
        .select('*, checklist_items(label, item_type)')
        .eq('job_id', approval.job_id)
        .eq('user_id', approval.user_id))
    }

    let photoUrls: Record<string, string> = {}
    for (const sub of submissions || []) {
      if (sub.photo_path) {
        const { data } = await service.storage.from('vantro-media').createSignedUrl(sub.photo_path, 3600)
        if (data) photoUrls[sub.id] = data.signedUrl
      }
    }
    return { ...approval, submissions: submissions || [], photoUrls }
  }))

  return NextResponse.json({ approvals: results })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const service = await createServiceClient()
  const { data: userData } = await service.from('users').select('company_id, id').eq('auth_user_id', user.id).single()
  if (!userData) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { approvalId, action, note } = await request.json()

  // Hold-point gate: can't approve until every submitted hold-point item has RFL sign-off.
  if (action === 'approved') {
    try {
      const { data: appr } = await service.from('qa_approvals').select('job_id, user_id').eq('id', approvalId).single()
      if (appr) {
        const { data: subs, error: sErr } = await service
          .from('qa_submissions')
          .select('rfl_initials, checklist_items(hold_point, label)')
          .eq('job_id', appr.job_id)
          .eq('user_id', appr.user_id)
        if (!sErr) {
          const pending = (subs || []).filter((s: any) => s.checklist_items?.hold_point === true && !(s.rfl_initials && String(s.rfl_initials).trim()))
          if (pending.length) {
            return NextResponse.json({
              error: `Cannot approve — ${pending.length} hold point${pending.length === 1 ? '' : 's'} still need RFL sign-off.`,
              holdPointsPending: pending.length,
            }, { status: 400 })
          }
        }
      }
    } catch { /* if hold_point/rfl columns aren't migrated yet, skip the gate */ }
  }

  const { error } = await service.from('qa_approvals').update({
    status: action,
    rejection_note: note || null,
    reviewed_at: new Date().toISOString(),
    reviewed_by: userData.id
  }).eq('id', approvalId)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
