import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import Stripe from 'stripe'
import { PLANS } from '@/lib/billing'
import type { Plan } from '@/lib/plan'
import { generateSlug, getInitials, defaultSchedule as makeDefaultSchedule } from '@/lib/provisioning'

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured')
  return new Stripe(key)
}

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
  // Rate limit: 3 signups per IP per hour, prevents Stripe/Supabase pollution
  const ip = getClientIp(request)
  const ok = await checkRateLimit(`signup:ip:${ip}`, 3, 3600)
  if (!ok) {
    return NextResponse.json({ error: 'Too many signup attempts. Try again later.' }, { status: 429 })
  }

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
  if (!PLANS[plan as Plan]) {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
  }

  const tier = PLANS[plan as Plan]
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

  // Free signs up without Stripe. The paid path relies on the checkout webhook
  // to provision the company, and there is no checkout here, so the rows are
  // created directly. Everything else about the company is identical, which is
  // what lets an upgrade later be a plan change rather than a migration.
  if ((plan as Plan) === 'free') {
    const slug = generateSlug(companyName.trim())
    const defaultSchedule = makeDefaultSchedule()

    const { data: company, error: compErr } = await service
      .from('companies')
      .insert({
        name: companyName.trim(),
        slug,
        plan: 'free',
        subscription_status: 'free',
        default_schedule: defaultSchedule,
      })
      .select('id')
      .single()

    if (compErr || !company) {
      console.error('[signup] free company insert failed:', compErr)
      return NextResponse.json({ error: 'Could not create your company' }, { status: 500 })
    }

    const adminName = yourName.trim()
    const { error: userErr } = await service.from('users').insert({
      company_id: company.id,
      auth_user_id: authUserId,
      email: email.toLowerCase().trim(),
      name: adminName,
      initials: getInitials(adminName),
      role: 'admin',
      is_active: true,
    })

    if (userErr) {
      // Roll the company back rather than leave one nobody can sign in to.
      await service.from('companies').delete().eq('id', company.id)
      console.error('[signup] free user insert failed:', userErr)
      return NextResponse.json({ error: 'Could not create your account' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, plan: 'free', companyId: company.id })
  }

  // Step 2: Create Stripe customer immediately so we can attach metadata
  const customer = await getStripe().customers.create({
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
    const session = await getStripe().checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer: customer.id,
      line_items: [{ price: tier.priceId as string, quantity: 1 }],
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
