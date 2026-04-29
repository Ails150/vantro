import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

export const config = {
  api: { bodyParser: false },
}

export async function POST(request: Request) {
  const body = await request.text()
  const sig = request.headers.get('stripe-signature')!

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err?.message)
    return NextResponse.json({ error: 'Webhook signature error' }, { status: 400 })
  }

  const service = await createServiceClient()

  try {
    switch (event.type) {
      // Card collected at signup — subscription created in trial
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const companyId = session.metadata?.company_id
        const plan = session.metadata?.plan
        const customerId = session.customer as string
        const subscriptionId = session.subscription as string

        if (!companyId) break

        const update: any = {
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          subscription_status: 'trialing', // 30-day trial begins
        }
        if (plan) update.plan = plan

        await service.from('companies').update(update).eq('id', companyId)
        console.log(`[webhook] checkout completed for company ${companyId}, status=trialing`)
        break
      }

      // Subscription state changed — sync from source of truth (Stripe)
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as any
        const companyId = sub.metadata?.company_id
        if (!companyId) break

        // Map Stripe status to our internal status
        let status: string = sub.status
        if (sub.status === 'trialing') status = 'trialing'
        else if (sub.status === 'active') status = 'active'
        else if (sub.status === 'past_due') status = 'past_due'
        else if (sub.status === 'unpaid') status = 'unpaid'
        else if (sub.status === 'canceled') status = 'cancelled'

        await service.from('companies').update({
          subscription_status: status,
          stripe_subscription_id: sub.id,
        }).eq('id', companyId)
        console.log(`[webhook] subscription ${sub.id} → ${status} for company ${companyId}`)
        break
      }

      // Trial ending in 3 days — Stripe handles email automatically if enabled
      case 'customer.subscription.trial_will_end': {
        const sub = event.data.object as any
        const companyId = sub.metadata?.company_id
        console.log(`[webhook] trial_will_end for company ${companyId}, sub ${sub.id}`)
        // Stripe sends the email — nothing to do here unless you want custom logic
        break
      }

      // Subscription cancelled (after period end or immediately)
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        const companyId = (sub as any).metadata?.company_id
        if (!companyId) {
          // Fall back to looking up by subscription ID
          await service.from('companies')
            .update({ subscription_status: 'cancelled' })
            .eq('stripe_subscription_id', sub.id)
        } else {
          await service.from('companies')
            .update({ subscription_status: 'cancelled' })
            .eq('id', companyId)
        }
        console.log(`[webhook] subscription deleted: ${sub.id}`)
        break
      }

      // Payment failed — Stripe will smart-retry, status moves to past_due
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        await service.from('companies')
          .update({ subscription_status: 'past_due' })
          .eq('stripe_customer_id', invoice.customer as string)
        console.log(`[webhook] payment_failed for customer ${invoice.customer}`)
        break
      }

      // Payment succeeded — restore active if was past_due
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice
        await service.from('companies')
          .update({ subscription_status: 'active' })
          .eq('stripe_customer_id', invoice.customer as string)
        console.log(`[webhook] payment_succeeded for customer ${invoice.customer}`)
        break
      }

      default:
        console.log(`[webhook] unhandled event: ${event.type}`)
    }

    return NextResponse.json({ received: true })
  } catch (err: any) {
    console.error('[webhook] handler error:', err?.message || err)
    // Return 200 anyway so Stripe doesn't retry — log for review
    return NextResponse.json({ received: true, error: err?.message })
  }
}
