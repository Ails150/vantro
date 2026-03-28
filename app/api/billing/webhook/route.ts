import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = await createServiceClient()
  const { data: profile } = await service
    .from('users')
    .select('id, company_id, stripe_customer_id, name')
    .eq('auth_user_id', user.id)
    .single()

  if (!profile) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  let customerId = profile.stripe_customer_id
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: profile.name,
      metadata: { company_id: profile.company_id, user_id: profile.id }
    })
    customerId = customer.id
    await service.from('users').update({ stripe_customer_id: customerId }).eq('id', profile.id)
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ['card'],
    line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
    mode: 'subscription',
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/admin?subscribed=true`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/billing`,
    metadata: { company_id: profile.company_id }
  })

  return NextResponse.json({ url: session.url })
}