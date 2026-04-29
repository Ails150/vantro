// lib/billing-guard.ts
// Centralised gate for write endpoints. Returns null if customer can write,
// or a NextResponse with 402 (Payment Required) if they cannot.
//
// Usage in any POST/PUT/DELETE route:
//   const gate = await guardWriteAccess()
//   if (gate) return gate
//   ...continue with the write...

import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from './supabase/server'

export interface WriteAccessGate {
  allowed: boolean
  reason?: 'unauthorised' | 'no_company' | 'trial_expired' | 'subscription_required'
  message?: string
}

export async function checkWriteAccess(): Promise<WriteAccessGate> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { allowed: false, reason: 'unauthorised', message: 'Not signed in' }

  const service = await createServiceClient()
  const { data: userData } = await service
    .from('users')
    .select('company_id, role')
    .eq('auth_user_id', user.id)
    .single()
  if (!userData?.company_id) return { allowed: false, reason: 'no_company' }

  const { data: company } = await service
    .from('companies')
    .select('subscription_status, trial_ends_at')
    .eq('id', userData.company_id)
    .single()

  if (!company) return { allowed: false, reason: 'no_company' }

  // Active subscription = always allowed
  if (company.subscription_status === 'active') return { allowed: true }

  // Trial: allowed unless past trial_ends_at
  if (company.subscription_status === 'trial') {
    if (!company.trial_ends_at) return { allowed: true }
    if (new Date() < new Date(company.trial_ends_at)) return { allowed: true }
    // Trial has expired
    return {
      allowed: false,
      reason: 'trial_expired',
      message: 'Your trial has ended. Subscribe to continue.'
    }
  }

  // Anything else: past_due, cancelled, etc -> blocked
  return {
    allowed: false,
    reason: 'subscription_required',
    message: 'Your subscription is not active. Update billing to continue.'
  }
}

/**
 * Wrap a route. Returns a NextResponse if blocked, null if allowed.
 *   const gate = await guardWriteAccess()
 *   if (gate) return gate
 */
export async function guardWriteAccess() {
  const access = await checkWriteAccess()
  if (access.allowed) return null
  if (access.reason === 'unauthorised') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  return NextResponse.json(
    { error: access.reason || 'forbidden', message: access.message },
    { status: 402 } // Payment Required
  )
}
