import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import Stripe from 'stripe'

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured')
  return new Stripe(key)
}

/**
 * POST /api/account/delete
 *
 * Permanently deletes a company and all associated data. GDPR Article 17 compliant.
 *
 * Body: { confirmation: string }  - must exactly match the company name
 *
 * Sequence:
 *  1. Confirm requester is admin of the company
 *  2. Verify confirmation text matches company name
 *  3. Cancel Stripe subscription immediately (not at period end)
 *  4. Delete all Supabase rows scoped by company_id
 *  5. Delete Supabase Auth user
 *  6. Sign out, return success - client redirects to landing
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const service = await createServiceClient()

  const { data: userData } = await service
    .from('users')
    .select('company_id, role')
    .eq('auth_user_id', user.id)
    .single()

  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  if (userData.role !== 'admin') {
    return NextResponse.json({ error: 'Only admins can delete the account' }, { status: 403 })
  }

  const { data: company } = await service
    .from('companies')
    .select('id, name, stripe_subscription_id, stripe_customer_id')
    .eq('id', userData.company_id)
    .single()

  if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

  let body: any = {}
  try { body = await request.json() } catch {}
  const confirmation = (body?.confirmation || '').trim()
  if (!confirmation || confirmation !== company.name) {
    return NextResponse.json(
      { error: 'Confirmation text does not match company name' },
      { status: 400 }
    )
  }

  const errors: string[] = []

  // 1. Cancel Stripe subscription immediately (full cancellation since they are deleting)
  if (company.stripe_subscription_id) {
    try {
      await getStripe().subscriptions.cancel(company.stripe_subscription_id)
    } catch (e: any) {
      console.error('[account/delete] Stripe cancel failed:', e?.message)
      errors.push('stripe_cancel_failed')
    }
  }

  const companyId = company.id

  // 2. Delete all rows scoped by company_id (children first, then parents)
  const tablesToClear = [
    'audit_packs',
    'qa_submissions',
    'diary_entries',
    'defects',
    'alerts',
    'signins',
    'job_checklists',
    'checklist_items',
    'checklist_templates',
    'time_off',
    'jobs',
    'users',
  ]

  for (const table of tablesToClear) {
    try {
      const { error } = await service.from(table).delete().eq('company_id', companyId)
      if (error) {
        console.error(`[account/delete] ${table} delete failed:`, error.message)
        errors.push(`${table}_failed`)
      }
    } catch (e: any) {
      console.error(`[account/delete] ${table} exception:`, e?.message)
      errors.push(`${table}_exception`)
    }
  }

  // 3. Delete the company row itself
  try {
    const { error } = await service.from('companies').delete().eq('id', companyId)
    if (error) {
      console.error('[account/delete] companies delete failed:', error.message)
      errors.push('companies_failed')
    }
  } catch (e: any) {
    errors.push('companies_exception')
  }

  // 4. Delete Supabase Auth user
  try {
    const { error } = await service.auth.admin.deleteUser(user.id)
    if (error) {
      console.error('[account/delete] auth user delete failed:', error.message)
      errors.push('auth_user_failed')
    }
  } catch (e: any) {
    errors.push('auth_user_exception')
  }

  // Sign out current session
  await supabase.auth.signOut()

  return NextResponse.json({
    success: true,
    deleted: { companyId, companyName: company.name },
    warnings: errors.length > 0 ? errors : undefined,
  })
}
