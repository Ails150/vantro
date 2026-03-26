import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { Resend } from 'resend'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const service = await createServiceClient()
  const { data: userData } = await service.from('users').select('company_id, name').eq('auth_user_id', user.id).single()
  if (!userData) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { data: company } = await service.from('companies').select('name').eq('id', userData.company_id).single()
  const { email, name } = await request.json()
  const resend = new Resend(process.env.RESEND_API_KEY)
  const setupLink = `https://app.getvantro.com/installer/setup?email=${encodeURIComponent(email)}`
  const { error } = await resend.emails.send({
    from: 'noreply@getvantro.com',
    to: email,
    subject: `You have been added to ${company?.name || 'your company'} on Vantro`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;">
        <h2 style="color:#111;">Hi ${name},</h2>
        <p style="color:#444;">You have been added as an installer on <strong>${company?.name || 'Vantro'}</strong>.</p>
        <p style="color:#444;">Click the button below to set up your account and access the installer app.</p>
        <a href="${setupLink}" style="display:inline-block;margin:24px 0;background:#00d4a0;color:#fff;font-weight:600;padding:14px 28px;border-radius:8px;text-decoration:none;">Set up my account</a>
        <p style="color:#888;font-size:13px;">If you did not expect this email, you can ignore it.</p>
      </div>
    `
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
