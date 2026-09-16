import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import Stripe from 'stripe'
import { collectCompanyKeys, purgeKeys, type PurgeResult } from '@/lib/r2-purge'

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured')
  return new Stripe(key)
}

/**
 * POST /api/account/delete
 *
 * Permanently deletes a company, its rows, its files and its logins.
 * Serves UK GDPR Article 17, within the limits stated at the bottom of this
 * comment.
 *
 * Body: { confirmation: string }  - must exactly match the company name
 *
 * Sequence:
 *  1. Confirm requester is admin of the company, and the typed confirmation
 *  2. Cancel the Stripe subscription immediately (not at period end)
 *  3. Read what must be read first: every auth id, every object key
 *  4. Purge object storage
 *  5. Delete every row scoped by company_id, children first
 *  6. Delete the company row, then EVERY auth user on it
 *  7. Sign out, return what was actually removed
 *
 * ON THE ARTICLE 17 CLAIM. This file said "GDPR Article 17 compliant" from the
 * day it was written while deleting rows from twelve tables out of forty-odd
 * and nothing at all from object storage. It is closer to true now, and the
 * response reports what could NOT be removed rather than printing success over
 * it. Two honest limits remain: backups roll off on their own schedule and are
 * not rewritten in place, and any audit pack already downloaded by a client is
 * beyond our reach entirely.
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

  // 2. Everything that has to be READ before anything is destroyed.
  //
  // Both of these live on rows that step 4 deletes. Reading them afterwards
  // finds nothing, and the files and logins they point at would survive
  // untouched with nothing left to find them by.

  // Every Supabase auth account on this company.
  const { data: companyUsers } = await service
    .from('users')
    .select('auth_user_id')
    .eq('company_id', companyId)
    .not('auth_user_id', 'is', null)
  const authUserIds: string[] = Array.from(
    new Set([
      ...((companyUsers ?? []) as any[]).map(u => u.auth_user_id).filter(Boolean),
      user.id,
    ]),
  )

  // 3. Object storage.
  //
  // This step did not exist until 2026-09-16, and its absence made the comment
  // at the top of this file untrue: every photograph, receipt, video, RAMS PDF
  // and walkthrough recording stayed in R2 after a company deleted its account
  // and was told its data was gone.
  let storage: PurgeResult = { deleted: 0, failed: [], skipped: true }
  try {
    const keys = await collectCompanyKeys(service, companyId)
    storage = await purgeKeys(keys)
    if (storage.skipped) errors.push('storage_not_configured')
    if (storage.failed.length > 0) errors.push(`storage_partial_${storage.failed.length}`)
  } catch (e: any) {
    console.error('[account/delete] storage purge threw:', e?.message)
    errors.push('storage_exception')
  }

  // 4. Delete all rows scoped by company_id (children first, then parents)
  //
  // This list was twelve tables long against a schema of forty-odd. Everything
  // added since it was written -- expenses, incidents, RAMS, toolbox talks,
  // walkthroughs, location pings, the pay tables -- survived a deletion that
  // claimed to be complete. Children first, people last, because everything
  // points at users.
  const tablesToClear = [
    // Evidence and its hashes
    'evidence_hashes',
    'audit_shares',
    'audit_pack_snoozes',
    'audit_ai_cache',
    'audit_packs',
    'audit_log',
    // Site records
    'walkthrough_clips',
    'walkthroughs',
    'variations',
    'qa_approvals',
    'qa_submissions',
    'diary_entries',
    'defects',
    'incidents',
    'rams_signatures',
    'rams_documents',
    'toolbox_talk_signatures',
    'toolbox_talks',
    'checklist_run_items',
    // Attendance and location
    'location_logs',
    'signins',
    // Money
    'pay_bonuses',
    'pay_rules',
    'payroll_exports',
    'expenses',
    // Scheduling
    'visit_assignments',
    'job_visits',
    'user_shifts',
    'leave_allowances',
    'time_off_entries',
    'job_assignments',
    // Configuration and structure
    'job_checklists',
    'checklist_items',
    'checklist_templates',
    'company_trades',
    'subcontractor_assignments',
    'subcontractors',
    'sites',
    'clients',
    'jobs',
    // Comms and support
    'email_alert_sends',
    'notification_log',
    'alerts',
    'support_access_log',
    'support_tickets',
    'data_subject_requests',
    // People last: everything above points at them
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

  // 5. Delete the company row itself
  try {
    const { error } = await service.from('companies').delete().eq('id', companyId)
    if (error) {
      console.error('[account/delete] companies delete failed:', error.message)
      errors.push('companies_failed')
    }
  } catch (e: any) {
    errors.push('companies_exception')
  }

  // 6. Delete the Supabase Auth users
  //
  // EVERY admin on the company, not just the one who clicked the button. The
  // previous version deleted only the caller, so a company with two
  // administrators left one of them with a working login to an account that no
  // longer existed -- and a live credential for a tenant that had asked to be
  // erased.
  //
  // authUserIds is captured BEFORE the users rows are deleted above; by this
  // point the rows are gone and there is nothing left to read them from.
  for (const authId of authUserIds) {
    try {
      const { error } = await service.auth.admin.deleteUser(authId)
      if (error) {
        console.error('[account/delete] auth user delete failed:', error.message)
        errors.push('auth_user_failed')
      }
    } catch (e: any) {
      errors.push('auth_user_exception')
    }
  }

  // Sign out current session
  await supabase.auth.signOut()

  return NextResponse.json({
    success: true,
    deleted: {
      companyId,
      companyName: company.name,
      tables: tablesToClear.length,
      authUsers: authUserIds.length,
      // Reported rather than swallowed. A deletion that left files behind is
      // something the person who asked for it is entitled to know about, and
      // "we deleted everything" must not be printed when it is not true.
      storageObjects: storage.deleted,
      storageFailed: storage.failed.length,
    },
    warnings: errors.length > 0 ? errors : undefined,
  })
}
