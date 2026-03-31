import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const service = await createServiceClient()
  const { email, name, role } = await request.json()

  const isForeman = role === 'foreman' || role === 'admin'

  if (isForeman) {
    const { data, error } = await service.auth.admin.generateLink({
      type: 'invite',
      email,
      options: { redirectTo: 'https://app.getvantro.com/auth/callback?next=/reset-password' }
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    const inviteUrl = data?.properties?.action_link
    if (!inviteUrl) return NextResponse.json({ error: 'Could not generate invite link' }, { status: 400 })

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Vantro <noreply@getvantro.com>',
        to: email,
        subject: 'You have been added to Vantro',
        html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
          <div style="background:#00C896;width:40px;height:40px;border-radius:8px;display:flex;align-items:center;justify-content:center;margin-bottom:24px">
            <span style="color:#07100D;font-weight:800;font-size:1rem">V</span>
          </div>
          <h2 style="color:#0A1A14;font-size:1.4rem;margin-bottom:12px">Welcome to Vantro</h2>
          <p style="color:#4A6158;line-height:1.6;margin-bottom:8px">Hi ${name || 'there'},</p>
          <p style="color:#4A6158;line-height:1.6;margin-bottom:24px">Your manager has added you as a <strong style="color:#0A1A14">Foreman</strong> on Vantro. You have full access to the dashboard — jobs, team, diary alerts, QA and payroll.</p>
          <ol style="color:#4A6158;line-height:2;margin-bottom:24px">
            <li>Click the button below to accept your invite</li>
            <li>Set your password</li>
            <li>Sign in at app.getvantro.com/login</li>
          </ol>
          <a href="${inviteUrl}" style="display:inline-block;background:#00C896;color:#07100D;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:0.95rem">Accept invite &amp; set password →</a>
          <p style="color:#888;font-size:12px;margin-top:24px">Link expires in 24 hours. Ask your manager to resend if expired.</p>
          <p style="color:#888;font-size:12px">Vantro · app.getvantro.com</p>
        </div>`
      })
    })
    return NextResponse.json({ success: true })
  }

  const redirectTo = `https://app.getvantro.com/installer/setup?email=${encodeURIComponent(email)}`
  const { error } = await service.auth.admin.inviteUserByEmail(email, { redirectTo })
  if (error && !error.message.includes('already been registered')) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  return NextResponse.json({ success: true })
}
