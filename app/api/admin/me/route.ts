// app/api/admin/me/route.ts
//
// Who am I. The caller's own role and company, and nothing else.
//
// Added because the Settings screen has to know whether two-factor is mandatory
// for the person looking at it, and the role lives in our users table rather
// than in the Supabase session. Deliberately minimal: this is not a general
// "fetch a user" endpoint, it answers one question about the caller and takes
// no parameters, so there is no id here for anyone to tamper with.

import { NextResponse } from "next/server"
import { getCallerContext } from "@/lib/company-context"
import { mfaRequiredFor } from "@/lib/mfa"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const ctx = await getCallerContext()
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  return NextResponse.json({
    role: ctx.role,
    name: ctx.name,
    companyId: ctx.companyId,
    mfaRequired: mfaRequiredFor(ctx.role),
  })
}
