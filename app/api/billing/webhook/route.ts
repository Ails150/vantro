import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

export const config = {
  api: { bodyParser: false },
}

function generateSlug(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  const suffix = Math.random().toString(36).slice(2, 6)
  return `${base || 'co'}-${suffix}`
}

function getInitials(name: string): string {
  return name.trim().split(/\s+/).map(p => p[0] || '').join('').toUpperCase().slice(0, 2)
}

export async function POST(request: Request) {
  const body = await request.text()
  const sig = request.headers.get('stripe-signature')!

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err: any) {
    console.error('[webhook] signature verification failed:', err?.message)
    return NextResponse.json({ error: 'Webhook signature error' }, { status: 400 })
  }

  const service = await createServiceClient()

  try {
    switch (event.type) {
      // ─── NEW SIGNUP: card collected, create company + admin user ───
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const meta = session.metadata || {}
        const authUserId = meta.auth_user_id
        const companyName = meta.company_name
        const plan = meta.plan
        const customerId = session.customer as string
        const subscriptionId = session.subscription as string

        if (!authUserId || !companyName) {
          console.error('[webhook] checkout.session.completed missing required metadata:', meta)
          break
        }

        // Idempotent: check if this user already has a company (in case webhook fires twice)
        const { data: existingUser } = await service
          .from('users')
          .select('company_id')
          .eq('auth_user_id', authUserId)
          .maybeSingle()

        if (existingUser?.company_id) {
          // Already provisioned — just update the subscription/customer IDs
          await service.from('companies').update({
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            subscription_status: 'trialing',
          }).eq('id', existingUser.company_id)
          console.log(`[webhook] checkout: existing user ${authUserId} → updated subscription`)
          break
        }

        // Get the auth user details (we need the email)
        const { data: authUser } = await service.auth.admin.getUserById(authUserId)
        if (!authUser?.user) {
          console.error(`[webhook] checkout: auth user ${authUserId} not found`)
          break
        }
        const adminEmail = authUser.user.email!
        const adminName = meta.admin_name || authUser.user.user_metadata?.full_name || 'Admin'

        // Create company — DB defaults handle country_code, status, trial_ends_at
        const slug = generateSlug(companyName)
        const { data: company, error: compErr } = await service
          .from('companies')
          .insert({
            name: companyName,
            slug,
            plan,
            installer_limit: parseInt(meta.installer_limit || '40', 10),
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            subscription_status: 'trialing',
          })
          .select('id')
          .single()

        if (compErr || !company) {
          console.error('[webhook] checkout: company insert failed:', compErr)
          break
        }

        // Create admin user record
        const { error: userErr } = await service.from('users').insert({
          company_id: company.id,
          auth_user_id: authUserId,
          email: adminEmail,
          name: adminName,
          initials: getInitials(adminName),
          role: 'admin',
          is_active: true,
        })

        if (userErr) {
          // Roll back the company so retry works
          await service.from('companies').delete().eq('id', company.id)
          console.error('[webhook] checkout: user insert failed, rolled back company:', userErr)
          break
        }

        console.log(`[webhook] checkout: provisioned company ${company.id} for user ${authUserId}`)
        break
      }

      // Subscription state changed — sync from source of truth (Stripe)
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as any
        const companyId = sub.metadata?.company_id

        // For existing companies (post-signup), update status
        if (companyId) {
          let status: string = sub.status
          if (sub.status === 'canceled') status = 'cancelled'
          await service.from('companies').update({
            subscription_status: status,
            stripe_subscription_id: sub.id,
          }).eq('id', companyId)
          console.log(`[webhook] subscription ${sub.id} → ${status} for company ${companyId}`)
        } else {
          // Lookup by customer ID as fallback
          const customerId = sub.customer as string
          let status: string = sub.status
          if (sub.status === 'canceled') status = 'cancelled'
          await service.from('companies').update({
            subscription_status: status,
          }).eq('stripe_customer_id', customerId)
        }
        break
      }

      case 'customer.subscription.trial_will_end': {
        const sub = event.data.object as any
        console.log(`[webhook] trial_will_end for sub ${sub.id}`)
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        await service.from('companies')
          .update({ subscription_status: 'cancelled' })
          .eq('stripe_subscription_id', sub.id)
        console.log(`[webhook] subscription deleted: ${sub.id}`)
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        await service.from('companies')
          .update({ subscription_status: 'past_due' })
          .eq('stripe_customer_id', invoice.customer as string)
        console.log(`[webhook] payment_failed: ${invoice.customer}`)
        break
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice
        await service.from('companies')
          .update({ subscription_status: 'active' })
          .eq('stripe_customer_id', invoice.customer as string)
        console.log(`[webhook] payment_succeeded: ${invoice.customer}`)
        break
      }

      default:
        console.log(`[webhook] unhandled: ${event.type}`)
    }

    return NextResponse.json({ received: true })
  } catch (err: any) {
    console.error('[webhook] handler error:', err?.message || err)
    // Return 200 anyway so Stripe doesn't retry — log for review
    return NextResponse.json({ received: true, error: err?.message })
  }
}
