import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

/**
 * POST /api/onboarding
 *
 * Steps must run in order: company → installers → jobs
 * Step N requires step N-1 to have completed successfully.
 * No silent fallbacks — if a step's prerequisite is missing, return 412 Precondition Failed.
 *
 * Response shape on error:
 *   { error: string, detail?: string, code?: string }
 *
 * Response shape on success:
 *   { success: true, ...stepData }
 */

type Body = {
  step: 'company' | 'installers' | 'jobs'
  companyName?: string
  companySlug?: string
  installers?: Array<{ name: string; email: string; role?: string }>
  jobs?: Array<{ name: string; address: string }>
}

function generateSlug(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  // Append short random suffix to avoid collisions
  const suffix = Math.random().toString(36).slice(2, 6)
  return `${base || 'co'}-${suffix}`
}

function getInitials(name: string): string {
  return name.trim().split(/\s+/).map(p => p[0] || '').join('').toUpperCase().slice(0, 2)
}

export async function POST(request: Request) {
  let body: Body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { step } = body
  if (!step) return NextResponse.json({ error: 'Step required' }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const service = await createServiceClient()

  // ─── STEP 1: COMPANY ──────────────────────────────────────────
  if (step === 'company') {
    const { companyName } = body
    if (!companyName?.trim()) {
      return NextResponse.json({ error: 'Company name is required' }, { status: 400 })
    }

    // Idempotent: if user already has a company, return it
    const { data: existingUser } = await service
      .from('users')
      .select('company_id')
      .eq('auth_user_id', user.id)
      .maybeSingle()

    if (existingUser?.company_id) {
      return NextResponse.json({ success: true, companyId: existingUser.company_id, alreadyExisted: true })
    }

    // Create company — DB defaults handle country_code, status, trial_ends_at
    const slug = body.companySlug?.trim() || generateSlug(companyName)
    const { data: company, error: compErr } = await service
      .from('companies')
      .insert({ name: companyName.trim(), slug })
      .select('id')
      .single()

    if (compErr) {
      console.error('[onboarding/company] insert failed:', compErr)
      return NextResponse.json({
        error: 'Could not create company',
        detail: compErr.message,
        code: compErr.code,
      }, { status: 400 })
    }

    // Create admin user
    const fullName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'Admin'
    const { error: userErr } = await service.from('users').insert({
      company_id: company.id,
      email: user.email,
      name: fullName,
      initials: getInitials(fullName),
      role: 'admin',
      auth_user_id: user.id,
      is_active: true,
    })

    if (userErr) {
      // Roll back the company so this is retryable
      await service.from('companies').delete().eq('id', company.id)
      console.error('[onboarding/company] user insert failed, rolled back company:', userErr)
      return NextResponse.json({
        error: 'Could not create admin user',
        detail: userErr.message,
        code: userErr.code,
      }, { status: 400 })
    }

    return NextResponse.json({ success: true, companyId: company.id })
  }

  // ─── STEP 2: INSTALLERS ───────────────────────────────────────
  if (step === 'installers') {
    const { installers } = body

    // Hard requirement: company must already exist
    const { data: userData, error: lookupErr } = await service
      .from('users')
      .select('company_id')
      .eq('auth_user_id', user.id)
      .maybeSingle()

    if (lookupErr) {
      console.error('[onboarding/installers] user lookup failed:', lookupErr)
      return NextResponse.json({
        error: 'Could not look up your account',
        detail: lookupErr.message,
      }, { status: 500 })
    }

    if (!userData?.company_id) {
      return NextResponse.json({
        error: 'Please complete the Company step first',
        code: 'PRECONDITION_FAILED',
      }, { status: 412 })
    }

    if (!installers?.length) {
      return NextResponse.json({ error: 'Add at least one team member' }, { status: 400 })
    }

    const valid = installers.filter(i => i.name?.trim() && i.email?.trim())
    if (!valid.length) {
      return NextResponse.json({ error: 'Each team member needs a name and email' }, { status: 400 })
    }

    const insertData = valid.map(inst => ({
      company_id: userData.company_id,
      email: inst.email.trim().toLowerCase(),
      name: inst.name.trim(),
      initials: getInitials(inst.name),
      role: inst.role || 'installer',
      is_active: true,
    }))

    const { error: insertErr, data: inserted } = await service
      .from('users')
      .insert(insertData)
      .select('id, email')

    if (insertErr) {
      console.error('[onboarding/installers] insert failed:', insertErr)
      // Helpful message for unique violation (duplicate email)
      const friendly = insertErr.code === '23505'
        ? 'One of those email addresses is already registered'
        : 'Could not add team members'
      return NextResponse.json({
        error: friendly,
        detail: insertErr.message,
        code: insertErr.code,
      }, { status: 400 })
    }

    return NextResponse.json({ success: true, addedCount: inserted?.length || 0 })
  }

  // ─── STEP 3: JOBS ─────────────────────────────────────────────
  if (step === 'jobs') {
    const { jobs } = body

    const { data: userData } = await service
      .from('users')
      .select('company_id')
      .eq('auth_user_id', user.id)
      .maybeSingle()

    if (!userData?.company_id) {
      return NextResponse.json({
        error: 'Please complete the Company step first',
        code: 'PRECONDITION_FAILED',
      }, { status: 412 })
    }

    // Jobs are optional at onboarding — empty array is fine
    if (!jobs?.length) {
      return NextResponse.json({ success: true, addedCount: 0 })
    }

    const valid = jobs.filter(j => j.name?.trim() && j.address?.trim())
    if (!valid.length) {
      return NextResponse.json({ success: true, addedCount: 0 })
    }

    const { error, data: inserted } = await service
      .from('jobs')
      .insert(valid.map(job => ({
        company_id: userData.company_id,
        name: job.name.trim(),
        address: job.address.trim(),
        status: 'active',
      })))
      .select('id')

    if (error) {
      console.error('[onboarding/jobs] insert failed:', error)
      return NextResponse.json({
        error: 'Could not create jobs',
        detail: error.message,
        code: error.code,
      }, { status: 400 })
    }

    return NextResponse.json({ success: true, addedCount: inserted?.length || 0 })
  }

  return NextResponse.json({ error: `Unknown step: ${step}` }, { status: 400 })
}
