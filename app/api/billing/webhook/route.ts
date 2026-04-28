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

  // audit_log_v1: idempotency + audit log via billing_events table.
  // Unique constraint on stripe_event_id prevents double-processing on Stripe retries.
  // If this insert fails because event was already logged, return 200 immediately.
  try {
    const obj: any = event.data.object
    const companyId =
      obj?.metadata?.company_id ||
      (obj?.customer ? (await service.from('companies').select('id').eq('stripe_customer_id', obj.customer).maybeSingle()).data?.id : null) ||
      null
    const { error: auditError } = await service.from('billing_events').insert({
      stripe_event_id: event.id,
      event_type: event.type,
      company_id: companyId,
      data: event.data.object as any,
    })
    if (auditError && auditError.code === '23505') {
      // Duplicate key violation = event already processed. Stripe is retrying. Return 200.
      return NextResponse.json({ received: true, duplicate: true })
    }
  } catch (err) {
    // If billing_events table doesn't exist yet, log and continue (don't break webhook).
    console.error('billing_events audit log error:', err)
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const companyId = session.metadata?.company_id
    if (!companyId) return NextResponse.json({ received: true })

    if (session.mode === 'setup') {
      await service.from('companies').update({
        card_collected_at: new Date().toISOString(),
        stripe_customer_id: session.customer as string,
      }).eq('id', companyId)
    }

    if (session.mode === 'subscription') {
      await service.from('companies').update({
        subscription_status: 'active',
        stripe_subscription_id: session.subscription as string,
        stripe_customer_id: session.customer as string,
        card_collected_at: new Date().toISOString(),
      }).eq('id', companyId)
    }
  }

  if (event.type === 'customer.subscription.created') {
    const subscription = event.data.object as Stripe.Subscription
    const companyId = subscription.metadata?.company_id
    if (!companyId) return NextResponse.json({ received: true })

    const plan = subscription.metadata?.plan || 'starter'
    const installerLimit = parseInt(subscription.metadata?.installer_limit || '40')

    await service.from('companies').update({
      subscription_status: 'active',
      stripe_subscription_id: subscription.id,
      plan,
      installer_limit: installerLimit,
    }).eq('id', companyId)
  }

  if (event.type === 'customer.subscription.updated') {
    const subscription = event.data.object as Stripe.Subscription
    const companyId = subscription.metadata?.company_id
    if (!companyId) return NextResponse.json({ received: true })

    const updates: Record<string, any> = {
      stripe_subscription_id: subscription.id,
      subscription_status: subscription.status === 'active' ? 'active' : subscription.status,
    }
    if (subscription.metadata?.plan) updates.plan = subscription.metadata.plan
    if (subscription.metadata?.installer_limit) updates.installer_limit = parseInt(subscription.metadata.installer_limit)

    await service.from('companies').update(updates).eq('id', companyId)
  }

  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object as Stripe.Subscription
    const companyId = subscription.metadata?.company_id

    if (!companyId) {
      const { data } = await service
        .from('companies')
        .select('id')
        .eq('stripe_customer_id', subscription.customer as string)
        .single()
      if (data) {
        await service.from('companies').update({ subscription_status: 'cancelled' }).eq('id', data.id)
      }
      return NextResponse.json({ received: true })
    }
    await service.from('companies').update({ subscription_status: 'cancelled' }).eq('id', companyId)
  }

  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object as Stripe.Invoice
    const { data: company } = await service
      .from('companies')
      .select('id')
      .eq('stripe_customer_id', invoice.customer as string)
      .single()
    if (company) {
      await service.from('companies').update({ subscription_status: 'past_due' }).eq('id', company.id)
    }
  }

  if (event.type === 'invoice.payment_succeeded') {
    const invoice = event.data.object as Stripe.Invoice
    const { data: company } = await service
      .from('companies')
      .select('id, subscription_status')
      .eq('stripe_customer_id', invoice.customer as string)
      .single()
    if (company && company.subscription_status === 'past_due') {
      await service.from('companies').update({ subscription_status: 'active' }).eq('id', company.id)
    }
  }

  return NextResponse.json({ received: true })
}