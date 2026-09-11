// app/api/admin/invite-link/route.ts
//
// GET /api/admin/invite-link -> the company's shareable worker join link.
//
// One link per company rather than one per person. A supervisor standing in a
// site cabin with six lads is not going to type six email addresses; they are
// going to paste one link into the group chat. That is the whole point of the
// free tier's onboarding, so the link is what the product hands them.
//
// The token is signed, not stored (see lib/auth.ts), so this endpoint is pure
// computation -- it mints a fresh 30-day token every time it is called, and an
// older one keeps working until it expires.

import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"
import { createInviteToken } from "@/lib/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ADMIN_ROLES = ["admin", "foreman", "superadmin", "support"]

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const service = await createServiceClient()
  const { data: admin } = await service
    .from("users")
    .select("id, company_id, role")
    .eq("auth_user_id", user.id)
    .single()
  if (!admin || !ADMIN_ROLES.includes(admin.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { data: company } = await service
    .from("companies")
    .select("name")
    .eq("id", admin.company_id)
    .single()

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.getvantro.com"
  const token = createInviteToken(admin.company_id)

  return NextResponse.json({
    url: `${appUrl}/join/${token}`,
    companyName: company?.name || "your team",
    expiresInDays: 30,
  })
}
