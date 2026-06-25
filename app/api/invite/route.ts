import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const service = await createServiceClient()
  const { email, name, role } = await request.json()

  // Dashboard users (admin + foreman) get the set-password invite flow.
  // Installers get the app-download email instead.
  const isDashboardUser = role === 'foreman' || role === 'admin'
  const isAdmin = role === 'admin'
  const roleLabel = isAdmin ? 'Admin' : 'Foreman'
  const roleArticle = isAdmin ? 'an' : 'a'
  const roleBlurb = isAdmin
    ? 'Your manager has added you as an <strong style="color:#0A1A14">Admin</strong> on Vantro. You have full access to the dashboard - jobs, team, diary alerts, QA, payroll and company settings.'
    : 'Your manager has added you as a <strong style="color:#0A1A14">Foreman</strong> on Vantro. You have full access to the dashboard - jobs, team, diary alerts, QA and payroll.'

  if (isDashboardUser) {
    const { data, error } = await service.auth.admin.generateLink({
      type: 'invite',
      email,
      options: { redirectTo: 'https://app.getvantro.com/auth/callback?next=/set-password' }
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
        subject: `You have been added to Vantro as ${roleArticle} ${roleLabel}`,
        html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
          <div style="background:#00C896;width:40px;height:40px;border-radius:8px;display:flex;align-items:center;justify-content:center;margin-bottom:24px">
            <span style="color:#07100D;font-weight:800;font-size:1rem">V</span>
          </div>
          <h2 style="color:#0A1A14;font-size:1.4rem;margin-bottom:12px">Welcome to Vantro</h2>
          <p style="color:#4A6158;line-height:1.6;margin-bottom:8px">Hi ${name || 'there'},</p>
          <p style="color:#4A6158;line-height:1.6;margin-bottom:24px">${roleBlurb}</p>
          <ol style="color:#4A6158;line-height:2;margin-bottom:24px">
            <li>Click the button below to accept your invite</li>
            <li>Set your password</li>
            <li>Sign in at app.getvantro.com/login</li>
          </ol>
          <a href="${inviteUrl}" style="display:inline-block;background:#00C896;color:#07100D;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:0.95rem">Accept invite and set password</a>
          <p style="color:#888;font-size:12px;margin-top:24px">Link expires in 24 hours. Ask your manager to resend if expired.</p>

          <div style="margin-top:32px;padding-top:24px;border-top:1px solid #DCE5E0">
            <p style="color:#0A1A14;font-weight:700;margin-bottom:8px">Before you roll out to your team</p>
            <p style="color:#4A6158;line-height:1.6;margin-bottom:12px">Send the GPS Tracking Explainer and the Installer How-To Guide to every installer before they start. Use the GDPR Quick-Reference as your script when briefing them. All docs are inside Vantro at <strong style="color:#0A1A14">gear icon then Compliance</strong>:</p>
            <p style="line-height:2;margin-bottom:0">
              <a href="https://app.getvantro.com/legal/Vantro_GPS_Tracking_Explainer.pdf" style="color:#0F6E56;text-decoration:none;font-weight:600">GPS Tracking Explainer</a><br>
              <a href="https://app.getvantro.com/legal/Vantro_Installer_HowTo_Guide.pdf" style="color:#0F6E56;text-decoration:none;font-weight:600">Installer How-To Guide</a><br>
              <a href="https://app.getvantro.com/legal/Vantro_GDPR_QuickRef_for_Andy.pdf" style="color:#0F6E56;text-decoration:none;font-weight:600">GDPR Quick-Reference (for office managers)</a><br>
              <a href="https://app.getvantro.com/legal/Vantro_Privacy_Policy.pdf" style="color:#0F6E56;text-decoration:none;font-weight:600">Privacy Policy</a><br>
              <a href="https://app.getvantro.com/legal/Vantro_Data_Processing_Agreement.pdf" style="color:#0F6E56;text-decoration:none;font-weight:600">Data Processing Agreement</a>
            </p>
          </div>

          <p style="color:#888;font-size:12px;margin-top:24px">Vantro - app.getvantro.com</p>
        </div>`
      })
    })
    return NextResponse.json({ success: true })
  }

  // Installer - plain email, no Supabase auth needed
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Vantro <noreply@getvantro.com>',
      to: email,
      subject: "You've been added to Vantro - download the app",
      html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
        <div style="background:#00C896;width:40px;height:40px;border-radius:8px;display:flex;align-items:center;justify-content:center;margin-bottom:24px">
          <span style="color:#07100D;font-weight:800;font-size:1rem">V</span>
        </div>
        <h2 style="color:#0A1A14;font-size:1.4rem;margin-bottom:12px">Welcome to Vantro</h2>
        <p style="color:#4A6158;line-height:1.6;margin-bottom:8px">Hi ${name || 'there'},</p>
        <p style="color:#4A6158;line-height:1.6;margin-bottom:24px">Your manager has added you as an <strong style="color:#0A1A14">Installer</strong> on Vantro. Use the app to sign in to jobs, log your diary and complete QA checklists on site.</p>

        <p style="color:#0A1A14;font-weight:700;margin-bottom:12px">Step 1 - Download the app</p>
        <a href="https://apps.apple.com/app/vantro/id6762612407" style="display:inline-block;background:#0A1A14;color:#FFFFFF;padding:14px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:0.95rem;margin-right:8px;margin-bottom:8px">Download on App Store</a>
        <a href="https://play.google.com/store/apps/details?id=com.getvantro.app" style="display:inline-block;background:#0A1A14;color:#FFFFFF;padding:14px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:0.95rem;margin-bottom:8px">Get it on Google Play</a>
        <p style="color:#4A6158;line-height:1.6;margin-top:16px;margin-bottom:4px">Tap the button for your phone - iPhone users use the App Store, Android users use Google Play.</p>

        <p style="color:#0A1A14;font-weight:700;margin-top:24px;margin-bottom:8px">Step 2 - Set up your PIN</p>
        <p style="color:#4A6158;line-height:1.6;margin-top:16px;margin-bottom:4px">Open the Vantro app, tap <strong style="color:#0A1A14">New installer? Tap here to set up</strong> at the bottom, enter <strong style="color:#0A1A14">this email address</strong> (the one this invite was sent to) and choose a 4-digit PIN. You are now ready to sign in to jobs on site.</p>

        <p style="color:#0A1A14;font-weight:700;margin-top:24px;margin-bottom:8px">Step 3 - Read this before you start</p>
        <p style="color:#4A6158;line-height:1.6;margin-bottom:12px">Vantro records when you sign in and sign out of shifts, along with your GPS location at those moments. It does <strong style="color:#0A1A14">not</strong> track you outside your shift. It does <strong style="color:#0A1A14">not</strong> follow you minute-by-minute during the day. Two short documents explain exactly what is tracked, when, and why - please take 5 minutes to read both before you start:</p>
        <p style="line-height:2;margin-bottom:12px">
          <a href="https://app.getvantro.com/legal/Vantro_GPS_Tracking_Explainer.pdf" style="color:#0F6E56;text-decoration:none;font-weight:700">GPS Tracking Explainer (PDF)</a><br>
          <a href="https://app.getvantro.com/legal/Vantro_Installer_HowTo_Guide.pdf" style="color:#0F6E56;text-decoration:none;font-weight:700">Installer How-To Guide (PDF)</a>
        </p>
        <p style="color:#4A6158;line-height:1.6;font-size:13px;margin-bottom:16px">If anything in those docs is not clear, ask your manager - they have the full GDPR pack.</p>

        <p style="color:#888;font-size:12px;margin-top:24px">Need help? Contact your manager or email aileen@applyscale8.com</p>
        <p style="color:#888;font-size:12px">Vantro - getvantro.com</p>
      </div>`
    })
  })

  return NextResponse.json({ success: true })
}
