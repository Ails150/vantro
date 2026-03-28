import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

export async function POST(request: Request) {
  const body = await request.text()
  const sig = request.headers.get('stripe-signature')!
  
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err) {
    return NextResponse.json({ error: 'Webhook error' }, { status: 400 })
  }

  const service = await createServiceClient()

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const companyId = session.metadata?.company_id
    const subscriptionId = session.subscription as string
    await service.from('users')
      .update({ subscription_status: 'active', stripe_subscription_id: subscriptionId })
      .eq('company_id', companyId)
  }

  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object as Stripe.Subscription
    await service.from('users')
      .update({ subscription_status: 'cancelled' })
      .eq('stripe_subscription_id', subscription.id)
  }

  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object as Stripe.Invoice
    await service.from('users')
      .update({ subscription_status: 'past_due' })
      .eq('stripe_customer_id', (invoice.customer as string))
  }

  return NextResponse.json({ received: true })
}