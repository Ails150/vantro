import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getCallerContext } from '@/lib/company-context'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// TEMPORARY diagnostic for the AI Audit Pack paywall. Delete once resolved.
// Returns only the caller's own context and their own company row, never any
// key material -- presence and length only.
export async function GET() {
  const ctx = await getCallerContext()
  if (!ctx) return NextResponse.json({ error: 'no caller context - not signed in' }, { status: 401 })

  const companyId = ctx.companyId
  const service = await createServiceClient()
  const rls = await createClient()

  const svc = companyId
    ? await service.from('companies').select('*').eq('id', companyId).single()
    : { data: null, error: { message: 'ctx.companyId is null', code: 'NO_COMPANY_ID' } as any }
  const anon = companyId
    ? await rls.from('companies').select('id, name, ai_audit_enabled').eq('id', companyId).single()
    : { data: null, error: { message: 'ctx.companyId is null', code: 'NO_COMPANY_ID' } as any }

  const c: any = svc.data

  return NextResponse.json({
    deployedSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    ctx: {
      companyId: ctx.companyId,
      baseCompanyId: ctx.baseCompanyId,
      role: ctx.role,
      isSupport: ctx.isSupport,
      userId: ctx.userId,
      email: ctx.email,
    },
    env: {
      hasServiceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      serviceKeyLen: (process.env.SUPABASE_SERVICE_ROLE_KEY || '').length,
      supabaseUrlRef: (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/^https:\/\/([a-z0-9]+)\..*$/, '$1'),
    },
    serviceRead: {
      error: svc.error ? { message: String(svc.error.message), code: String((svc.error as any).code) } : null,
      isNull: c == null,
      id: c?.id ?? null,
      name: c?.name ?? null,
      ai_audit_enabled: c ? c.ai_audit_enabled : 'NO_ROW',
      ai_audit_enabled_type: typeof c?.ai_audit_enabled,
      subscription_status: c?.subscription_status ?? null,
      trial_ends_at: c?.trial_ends_at ?? null,
      colCount: c ? Object.keys(c).length : 0,
    },
    rlsRead: {
      error: anon.error ? { message: String(anon.error.message), code: String((anon.error as any).code) } : null,
      isNull: anon.data == null,
      ai_audit_enabled: (anon.data as any)?.ai_audit_enabled ?? 'NO_ROW',
    },
    // Exactly the expression AdminDashboard.tsx:2590 feeds into AuditTab.
    gateWouldPass: !!c?.ai_audit_enabled,
  })
}
