import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import crypto from 'crypto'

export async function POST(request: Request) {
  const { email } = await request.json()
  if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 })

  // Rate limit: per-IP and per-email
  const ip = getClientIp(request)
  const ipOk = await checkRateLimit(`reset-pin:ip:${ip}`, 10, 3600)
  const emailOk = await checkRateLimit(`reset-pin:email:${email.trim().toLowerCase()}`, 3, 3600)
  if (!ipOk || !emailOk) {
    return NextResponse.json({ success: true }) // silent rate-limit
  }

  const service = await createServiceClient()
  const { data: user } = await service.from('users').select('id, name, email').ilike('email', email.trim()).single()
  if (!user) return NextResponse.json({ success: true }) // silent fail for security

  const token = crypto.randomBytes(32).toString('hex')
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days

  await service.from('users').update({ pin_reset_token: token, pin_reset_expires: expires }).eq('id', user.id)

  const resetUrl = `https://app.getvantro.com/installer/reset-pin?token=${token}`

  if (process.env.RESEND_API_KEY) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Vantro <noreply@getvantro.com>',
        to: email.trim(),
        subject: 'Reset your Vantro PIN',
        html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:40px auto">
          <div style="text-align:center;margin-bottom:24px">
            <div style="width:48px;height:48px;background:#00d4a0;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:22px;color:#0f1923">V</div>
          </div>
          <h2 style="color:#0f1923;text-align:center">Reset your PIN</h2>
          <p style="color:#444">Hi ${user.name},</p>
          <p style="color:#444">Click the button below to set a new PIN for your Vantro account. This link expires in 7 days.</p>
          <div style="text-align:center;margin:24px 0">
            <a href="${resetUrl}" style="background:#00d4a0;color:#0f1923;font-weight:700;padding:12px 28px;border-radius:10px;text-decoration:none;display:inline-block">Set new PIN →</a>
          </div>
          <p style="color:#888;font-size:12px">If you did not request this, ignore this email. Your PIN will not change.</p>
        </div>`
      })
    }).catch(() => {})
  }

  return NextResponse.json({ success: true })
}