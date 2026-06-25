import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"

// One-time bootstrap: provision Aileen as a platform "support" user.
// Protected by SUPPORT_BOOTSTRAP_SECRET (set it in env, then call once with
// header `x-bootstrap-secret: <secret>`). Creates her auth account (invite),
// emails the set-password link, and upserts her users row with role 'support'
// and no company (her company is chosen per-session via the switcher).
export const dynamic = "force-dynamic"

const AILEEN_EMAIL = "aileen@applyscale8.com"
const AILEEN_NAME = "Aileen O'Doherty"

export async function POST(request: Request) {
  const secret = request.headers.get("x-bootstrap-secret")
  if (!process.env.SUPPORT_BOOTSTRAP_SECRET || secret !== process.env.SUPPORT_BOOTSTRAP_SECRET) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const service = await createServiceClient()

  // Create (or fetch) the auth user and an invite link to set a password.
  const { data: linkData, error: linkError } = await service.auth.admin.generateLink({
    type: "invite",
    email: AILEEN_EMAIL,
    options: { redirectTo: "https://app.getvantro.com/auth/callback?next=/set-password" },
  })
  if (linkError) return NextResponse.json({ error: linkError.message }, { status: 400 })

  const authUserId = linkData?.user?.id
  const inviteUrl = linkData?.properties?.action_link
  if (!authUserId) return NextResponse.json({ error: "Could not create auth user" }, { status: 400 })

  // Upsert the platform support users row (company_id null -> not tied to any company).
  const { error: upErr } = await service.from("users").upsert({
    auth_user_id: authUserId,
    email: AILEEN_EMAIL,
    name: AILEEN_NAME,
    role: "support",
    company_id: null,
    is_active: true,
  }, { onConflict: "email" })
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 })

  // Email her the set-password link.
  if (process.env.RESEND_API_KEY && inviteUrl) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Vantro <noreply@getvantro.com>",
          to: AILEEN_EMAIL,
          subject: "Your Vantro platform support access",
          html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
            <h2 style="color:#0A1A14">Vantro platform support</h2>
            <p style="color:#4A6158;line-height:1.6">Hi ${AILEEN_NAME},</p>
            <p style="color:#4A6158;line-height:1.6">You've been set up with platform support access. Click below to set your password, then you'll be able to choose which company to view.</p>
            <a href="${inviteUrl}" style="display:inline-block;background:#00C896;color:#07100D;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700">Set password</a>
          </div>`,
        }),
      })
    } catch (e: any) {
      console.error("[support/provision] email failed:", e?.message)
    }
  }

  return NextResponse.json({ success: true, authUserId, emailed: !!(process.env.RESEND_API_KEY && inviteUrl) })
}
