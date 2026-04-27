import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import crypto from 'crypto'

export async function POST(request: Request) {
  const { email } = await request.json()
  if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 })

  const service = await createServiceClient()
  const { data: user } = await service.from('users')
    .select('id, name, email, role')
    .ilike('email', email.trim())
    .single()

  // Silent success for security (do not reveal whether email exists)
  if (!user) return NextResponse.json({ success: true })

  // Only admin/foreman roles can use password reset (installers use PIN reset)
  if (user.role === 'installer') return NextResponse.json({ success: true })

  const token = crypto.randomBytes(32).toString('hex')
  const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1 hour

  const { error: updateErr } = await service.from('users')
    .update({ password_reset_token: token, password_reset_expires: expires })
    .eq('id', user.id)

  if (updateErr) {
    console.error('[admin/reset-password] token save failed', updateErr)
    return NextResponse.json({ error: 'Could not start reset' }, { status: 500 })
  }

  const resetUrl = `https://app.getvantro.com/reset-password?token=${token}`

  if (process.env.RESEND_API_KEY) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Vantro <noreply@getvantro.com>',
        to: email.trim(),
        subject: 'Reset your Vantro password',
        html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:40px auto">
          <div style="text-align:center;margin-bottom:24px">
            <div style="width:48px;height:48px;background:#00d4a0;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:22px;color:#0f1923">V</div>
          </div>
          <h2 style="color:#0f1923;text-align:center">Reset your password</h2>
          <p style="color:#444">Hi ${user.name || 'there'},</p>
          <p style="color:#444">Click the button below to set a new password for your Vantro account. This link expires in 1 hour.</p>
          <div style="text-align:center;margin:24px 0">
            <a href="${resetUrl}" style="background:#00d4a0;color:#0f1923;font-weight:700;padding:12px 28px;border-radius:10px;text-decoration:none;display:inline-block">Set new password</a>
          </div>
          <p style="color:#888;font-size:12px">If the button does not work, copy and paste this URL into your browser:<br><span style="word-break:break-all">${resetUrl}</span></p>
          <p style="color:#888;font-size:12px">If you did not request this, ignore this email. Your password will not change.</p>
        </div>`
      })
    })

    if (!res.ok) {
      const body = await res.text()
      console.error('[admin/reset-password] Resend failed', res.status, body)
      return NextResponse.json({ error: 'Email could not be sent. Please try again or contact support.' }, { status: 500 })
    }
  } else {
    console.error('[admin/reset-password] RESEND_API_KEY not set')
    return NextResponse.json({ error: 'Email service not configured' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}