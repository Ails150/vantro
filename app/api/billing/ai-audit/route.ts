import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import Stripe from 'stripe'
import { AI_AUDIT_PACK } from '@/lib/billing'

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured")
  return new Stripe(key)
}

/**
 * POST /api/billing/ai-audit
 * Adds the AI Audit Pack subscription item to the company's existing subscription.
 *
 * Pricing: £79/mo, added as a line item to the existing base subscription.
 * Trial: aligns with parent subscription. If parent is still on trial, the new
 * item inherits the same trial_end (no immediate charge). If parent is past
 * trial, Stripe pro-rates by default and bills on the next invoice cycle.
 */
export async function POST(request: Request) {
  try {
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
      return NextResponse.json({ error: 'Only admins can manage billing' }, { status: 403 })
    }

    const { data: company } = await service
      .from('companies')
      .select('id, name, stripe_customer_id, stripe_subscription_id, ai_audit_enabled')
      .eq('id', userData.company_id)
      .single()

    if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

    if (company.ai_audit_enabled) {
      return NextResponse.json({ error: 'AI Audit Pack is already active' }, { status: 409 })
    }

    if (!company.stripe_subscription_id) {
      return NextResponse.json(
        { error: 'No active subscription found. Please complete base checkout first.' },
        { status: 400 }
      )
    }

    if (!AI_AUDIT_PACK.priceId) {
      return NextResponse.json(
        { error: 'AI Audit Pack price not configured. Contact support.' },
        { status: 500 }
      )
    }

    const stripe = getStripe()

    // Fetch the existing subscription to check trial state
    const subscription = await stripe.subscriptions.retrieve(company.stripe_subscription_id)

    // Guard: if AI Audit item somehow already on the subscription, flip the DB flag and return
    const existingItem = subscription.items.data.find(
      (item) => item.price.id === AI_AUDIT_PACK.priceId
    )
    if (existingItem) {
      await service
        .from('companies')
        .update({ ai_audit_enabled: true })
        .eq('id', company.id)
      return NextResponse.json({ success: true, alreadyAdded: true })
    }

    // Add the AI Audit Pack as a new subscription item via subscription.update()
    // This is the only way to also pass trial_end; subscriptionItems.create() does not accept it.
    // If parent is on trial, the new item naturally inherits trial alignment via the subscription.
    const isOnTrial = subscription.status === 'trialing' && subscription.trial_end != null

    await stripe.subscriptions.update(company.stripe_subscription_id, {
      items: [
        {
          price: AI_AUDIT_PACK.priceId,
          quantity: 1,
        },
      ],
      proration_behavior: isOnTrial ? 'none' : 'create_prorations',
      trial_end: isOnTrial && subscription.trial_end ? subscription.trial_end : undefined,
    })

    // Flip the DB flag immediately for snappy UX (webhook will also flip it as backup)
    await service
      .from('companies')
      .update({ ai_audit_enabled: true })
      .eq('id', company.id)

    return NextResponse.json({
      success: true,
      onTrial: isOnTrial,
      message: isOnTrial
        ? 'AI Audit Pack added to your trial. You will be charged £79/mo when your trial ends.'
        : 'AI Audit Pack added. Pro-rated charge will appear on your next invoice.',
    })
  } catch (e: any) {
    console.error('[ai-audit] upgrade failed:', e)
    return NextResponse.json(
      { error: e?.message || 'Failed to add AI Audit Pack' },
      { status: 500 }
    )
  }
}