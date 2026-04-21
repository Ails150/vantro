import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"
import crypto from "crypto"

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = await createServiceClient()
  const { data: u } = await service.from('users').select('company_id').eq('auth_user_id', user.id).single()
  if (!u) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const { name, email, jobId } = await request.json()
  if (!name || !email || !jobId) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const { data: job } = await service.from('jobs').select('name').eq('id', jobId).single()
  const inviteToken = crypto.randomBytes(32).toString('hex')

  const { data: existing } = await service.from('client_users').select('id').eq('email', email.toLowerCase()).eq('job_id', jobId).single()
  if (existing) {
    await service.from('client_users').update({ invite_token: inviteToken, invite_sent_at: new Date().toISOString() }).eq('id', existing.id)
  } else {
    await service.from('client_users').insert({ company_id: u.company_id, job_id: jobId, name, email: email.toLowerCase(), invite_token: inviteToken, invite_sent_at: new Date().toISOString() })
  }

  const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://app.getvantro.com'}/client/setup?token=${inviteToken}`

  if (process.env.RESEND_API_KEY) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Vantro <noreply@getvantro.com>',
        to: email,
        subject: `Your job portal access — ${job?.name || 'Your Job'}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:500px;margin:40px auto">
          <img src="https://app.getvantro.com/icon-192.png" width="48" style="border-radius:12px;margin-bottom:16px">
          <h2 style="color:#0f1923">You've been invited to view your job progress</h2>
          <p style="color:#444">Hi ${name},</p>
          <p style="color:#444">${job?.name ? `<strong>${job.name}</strong> is now tracked on Vantro.` : 'Your job is now tracked on Vantro.'} You can view live progress, photos, and reports any time.</p>
          <a href="${inviteUrl}" style="display:inline-block;background:#00d4a0;color:#0f1923;font-weight:700;padding:12px 24px;border-radius:10px;text-decoration:none;margin:16px 0">Set up your access →</a>
          <p style="color:#888;font-size:12px;margin-top:24px">This link expires in 7 days. Powered by Vantro — getvantro.com</p>
        </div>`
      })
    }).catch(() => {})
  }

  return NextResponse.json({ success: true, inviteUrl })
}