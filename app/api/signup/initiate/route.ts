import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import Stripe from 'stripe'
import { TIERS, type TierKey } from '@/lib/billing'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

/**
 * POST /api/signup/initiate
 *
 * Creates Supabase auth user (unconfirmed) + returns Stripe Checkout URL.
 * Company + admin user record in our DB are NOT created yet — that happens
 * via the Stripe webhook on checkout.session.completed.
 *
 * This means: if the user abandons checkout, no orphan company exists in our DB.
 *
 * Body: { email, password, companyName, yourName, teamSize, plan }
 */
export async function POST(request: Request) {
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { email, password, companyName, yourName, teamSize, plan } = body

  // Validation
  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
  }
  if (!companyName?.trim()) {
    return NextResponse.json({ error: 'Company name is required' }, { status: 400 })
  }
  if (!yourName?.trim()) {
    return NextResponse.json({ error: 'Your name is required' }, { status: 400 })
  }
  if (!teamSize || teamSize < 1 || teamSize > 100) {
    return NextResponse.json({ error: 'Team size must be between 1 and 100' }, { status: 400 })
  }
  if (!TIERS[plan as TierKey]) {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
  }

  const tier = TIERS[plan as TierKey]
  const service = await createServiceClient()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.getvantro.com'

  // Step 1: Create Supabase auth user (or detect existing)
  // Using admin API so we can auto-confirm and skip the email loop
  // (Email confirmation can happen post-Stripe if you want — for now we keep things simple)
  const { data: authData, error: authError } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // Auto-confirm; we'll trust Stripe's verification of the email
    user_metadata: {
      full_name: yourName.trim(),
      company_name: companyName.trim(),
      pending_plan: plan,
      pending_team_size: teamSize,
    },
  })

  if (authError) {
    // Common case: email already exists
    if (authError.message?.toLowerCase().includes('already')) {
      return NextResponse.json({
        error: 'An account with this email already exists',
        detail: 'Please sign in or use a different email',
      }, { status: 409 })
    }
    console.error('[signup/initiate] auth user creation failed:', authError)
    return NextResponse.json({
      error: 'Could not create account',
      detail: authError.message,
    }, { status: 500 })
  }

  const authUserId = authData.user.id

  // Step 2: Create Stripe customer immediately so we can attach metadata
  const customer = await stripe.customers.create({
    email: email.toLowerCase().trim(),
    name: companyName.trim(),
    metadata: {
      auth_user_id: authUserId,
      company_name: companyName.trim(),
      admin_name: yourName.trim(),
      plan,
      team_size: String(teamSize),
    },
  })

  // Step 3: Create Stripe Checkout session with 30-day trial
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer: customer.id,
      line_items: [{ price: tier.priceId, quantity: 1 }],
      subscription_data: {
        trial_period_days: 30,
        trial_settings: {
          end_behavior: {
            missing_payment_method: 'cancel',
          },
        },
        metadata: {
          auth_user_id: authUserId,
          company_name: companyName.trim(),
          admin_name: yourName.trim(),
          admin_email: email.toLowerCase().trim(),
          plan,
          installer_limit: String(tier.installerLimit),
          team_size: String(teamSize),
        },
      },
      payment_method_collection: 'always', // force card even on trial
      success_url: `${appUrl}/signup/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/signup?cancelled=true`,
      metadata: {
        auth_user_id: authUserId,
        company_name: companyName.trim(),
        plan,
      },
    })

    return NextResponse.json({
      checkoutUrl: session.url,
      sessionId: session.id,
    })
  } catch (err: any) {
    // If checkout fails, roll back auth user so they can retry cleanly
    await service.auth.admin.deleteUser(authUserId).catch(() => {})
    console.error('[signup/initiate] Stripe checkout failed:', err)
    return NextResponse.json({
      error: 'Could not start payment',
      detail: err?.message || String(err),
    }, { status: 500 })
  }
}
