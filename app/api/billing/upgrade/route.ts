import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import Stripe from 'stripe'
import { PLANS } from '@/lib/billing'
import type { Plan } from '@/lib/plan'

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured")
  return new Stripe(key)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { newPlan } = await request.json() as { newPlan: Plan }
  if (!PLANS[newPlan]?.priceId) return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })

  const service = await createServiceClient()

  const { data: userData } = await service
    .from('users')
    .select('company_id')
    .eq('auth_user_id', user.id)
    .single()
  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const { data: company } = await service
    .from('companies')
    .select('id, plan, stripe_subscription_id, stripe_customer_id, subscription_status')
    .eq('id', userData.company_id)
    .single()
  if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

  const newTier = PLANS[newPlan]
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.getvantro.com'

  if (company.stripe_subscription_id && company.subscription_status === 'active') {
    const subscription = await getStripe().subscriptions.retrieve(company.stripe_subscription_id)
    const subscriptionItemId = subscription.items.data[0].id

    await getStripe().subscriptions.update(company.stripe_subscription_id, {
      items: [{ id: subscriptionItemId, price: newTier.priceId as string }],
      proration_behavior: 'always_invoice',
      metadata: { plan: newPlan }
    })

    await service.from('companies').update({
      plan: newPlan,
    }).eq('id', company.id)

    return NextResponse.json({ success: true, message: `Upgraded to ${newTier.name}` })
  }

  await service.from('companies').update({
    plan: newPlan,
  }).eq('id', company.id)

  // checkout_email_fix_v1: Stripe needs customer or customer_email when creating
  // a Checkout session. If no stripe_customer_id yet, fall back to the auth user email.
  const checkoutPayload: any = {
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: newTier.priceId as string, quantity: 1 }],
    subscription_data: {
      metadata: { company_id: company.id, plan: newPlan }
    },
    success_url: `${appUrl}/admin?billing=upgraded`,
    cancel_url: `${appUrl}/admin?billing=cancelled`,
    metadata: { company_id: company.id }
  }
  if (company.stripe_customer_id) {
    checkoutPayload.customer = company.stripe_customer_id
  } else if (user.email) {
    checkoutPayload.customer_email = user.email
  } else {
    return NextResponse.json({ error: 'Cannot create checkout: no customer email available' }, { status: 400 })
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