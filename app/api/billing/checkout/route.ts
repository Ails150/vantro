import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const body = await request.json()
  const { mode } = body

  const service = await createServiceClient()

  const { data: userData } = await service
    .from('users')
    .select('company_id, email, name')
    .eq('auth_user_id', user.id)
    .single()
  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const { data: company } = await service
    .from('companies')
    .select('id, name, plan, stripe_customer_id, billing_email, installer_limit')
    .eq('id', userData.company_id)
    .single()
  if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

  let customerId = company.stripe_customer_id
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: company.billing_email || userData.email,
      name: company.name,
      metadata: { company_id: company.id, plan: company.plan }
    })
    customerId = customer.id
    await service.from('companies').update({ stripe_customer_id: customerId }).eq('id', company.id)
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.getvantro.com'

  if (mode === 'setup') {
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'setup',
      payment_method_types: ['card'],
      success_url: `${appUrl}/admin?billing=card_saved`,
      cancel_url: `${appUrl}/admin?billing=cancelled`,
      metadata: { company_id: company.id, plan: company.plan }
    })
    return NextResponse.json({ url: session.url })
  }

  if (mode === 'subscribe') {
    const priceId = getPriceIdForPlan(company.plan)
    if (!priceId) return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        metadata: {
          company_id: company.id,
          plan: company.plan,
          installer_limit: String(company.installer_limit),
        }
      },
      success_url: `${appUrl}/admin?billing=subscribed`,
      cancel_url: `${appUrl}/admin?billing=cancelled`,
      metadata: { company_id: company.id }
    })
    return NextResponse.json({ url: session.url })
  }

  return NextResponse.json({ error: 'Invalid mode' }, { status: 400 })
}

function getPriceIdForPlan(plan: string): string | null {
  const map: Record<string, string> = {
    starter: process.env.STRIPE_PRICE_STARTER!,
    growth: process.env.STRIPE_PRICE_GROWTH!,
    scale: process.env.STRIPE_PRICE_SCALE!,
  }
  return map[plan] || null
}