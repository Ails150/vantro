import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import Stripe from 'stripe'
import { TIERS, type TierKey } from '@/lib/billing'

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured")
  return new Stripe(key)
}

const isValidStripeCustomerId = (id: string | null | undefined): boolean => {
  if (!id) return false
  return /^cus_[A-Za-z0-9]{14,}$/.test(id) && !id.includes('TBD')
}

/**
 * POST /api/billing/checkout
 * Creates a Stripe Checkout session for SUBSCRIPTION with 30-day trial.
 * Card is collected upfront, no charge until trial ends.
 *
 * Body: { plan: 'starter' | 'growth' | 'scale' }
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { plan } = await request.json() as { plan: TierKey }
  if (!TIERS[plan]) return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })

  const service = await createServiceClient()
  const { data: userData } = await service
    .from('users')
    .select('company_id, role')
    .eq('auth_user_id', user.id)
    .single()
  if (!userData || userData.role !== 'admin') {
    return NextResponse.json({ error: 'Only admins can start subscriptions' }, { status: 403 })
  }

  const { data: company } = await service
    .from('companies')
    .select('id, name, stripe_customer_id, subscription_status, stripe_subscription_id')
    .eq('id', userData.company_id)
    .single()
  if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

  // If already has active subscription, redirect to portal instead
  if (company.stripe_subscription_id && ['active', 'trialing'].includes(company.subscription_status)) {
    return NextResponse.json({
      error: 'Subscription already exists',
      hint: 'Use /api/billing/portal to manage existing subscription'
    }, { status: 400 })
  }

  const tier = TIERS[plan]
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.getvantro.com'

  // Build checkout payload — subscription mode with 30-day trial
  const checkoutPayload: Stripe.Checkout.SessionCreateParams = {
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: tier.priceId, quantity: 1 }],
    subscription_data: {
      trial_period_days: 30,
      // Tells Stripe to send trial_will_end email 7 days before
      trial_settings: {
        end_behavior: {
          missing_payment_method: 'cancel', // belt-and-braces; card already collected
        }
      },
      metadata: {
        company_id: company.id,
        plan,
        installer_limit: String(tier.installerLimit)
      },
    },
    // Force card collection even on trial
    payment_method_collection: 'always',
    success_url: `${appUrl}/admin?welcome=true`,
    cancel_url: `${appUrl}/signup?cancelled=true`,
    metadata: { company_id: company.id, plan },
  }

  // Reuse existing Stripe customer if valid, else fall back to email
  if (isValidStripeCustomerId(company.stripe_customer_id)) {
    checkoutPayload.customer = company.stripe_customer_id!
  } else if (user.email) {
    checkoutPayload.customer_email = user.email
  } else {
    return NextResponse.json({ error: 'No email to create customer' }, { status: 400 })
  }

  try {
    const session = await getStripe().checkout.sessions.create(checkoutPayload)
    return NextResponse.json({ url: session.url })
  } catch (err: any) {
    console.error('Stripe Checkout creation failed:', err?.message || err)
    return NextResponse.json(
      { error: 'Could not create checkout session', detail: err?.message || String(err) },
      { status: 500 }
    )
  }
}
