import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { getCallerContext, SUPPORT_COMPANY_COOKIE } from "@/lib/company-context"

// A support user selects a company to view. We record the access for GDPR and
// set the cookie that scopes the rest of their session to that company.
export async function POST(request: Request) {
  const ctx = await getCallerContext()
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!ctx.isSupport) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const body = await request.json().catch(() => null)
  const companyId = body?.companyId
  if (!companyId || typeof companyId !== "string") {
    return NextResponse.json({ error: "companyId required" }, { status: 400 })
  }

  const service = await createServiceClient()
  const { data: company } = await service
    .from("companies").select("id, name").eq("id", companyId).single()
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 })

  // GDPR audit trail: who accessed which company, when.
  await service.from("support_access_log").insert({
    support_user_id: ctx.userId,
    support_email: ctx.email,
    company_id: company.id,
    company_name: company.name,
  })

  const res = NextResponse.json({ success: true })
  res.cookies.set(SUPPORT_COMPANY_COOKIE, company.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 60 * 60 * 8, // 8 hours
  })
  return res
}
