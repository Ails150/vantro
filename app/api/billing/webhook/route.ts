import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import Stripe from 'stripe'
import { AI_AUDIT_PACK } from '@/lib/billing'

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured")
  return new Stripe(key)
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
    event = getStripe().webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err: any) {
    return NextResponse.json({ error: 'Webhook signature error' }, { status: 400 })
  }
  const service = await createServiceClient()
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const meta = session.metadata || {}
        const authUserId = meta.auth_user_id
        const companyName = meta.company_name
        const plan = meta.plan
        const customerId = session.customer as string
        const subscriptionId = session.subscription as string
        if (!authUserId || !companyName) break
        const { data: existingUser } = await service.from('users').select('company_id').eq('auth_user_id', authUserId).maybeSingle()
        if (existingUser?.company_id) {
          const trialEndsAtExisting = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
          await service.from('companies').update({ stripe_customer_id: customerId, stripe_subscription_id: subscriptionId, subscription_status: 'trialing', ai_audit_enabled: true, ai_audit_trial_ends_at: trialEndsAtExisting, trial_ends_at: trialEndsAtExisting }).eq('id', existingUser.company_id)
          break
        }
        const { data: authUser } = await service.auth.admin.getUserById(authUserId)
        if (!authUser?.user) break
        const adminEmail = authUser.user.email!
        const adminName = meta.admin_name || authUser.user.user_metadata?.full_name || 'Admin'
        const slug = generateSlug(companyName)
        const defaultSchedule = { mon: { enabled: true, start: "08:00", end: "17:00" }, tue: { enabled: true, start: "08:00", end: "17:00" }, wed: { enabled: true, start: "08:00", end: "17:00" }, thu: { enabled: true, start: "08:00", end: "17:00" }, fri: { enabled: true, start: "08:00", end: "17:00" }, sat: { enabled: false }, sun: { enabled: false } }
        const trialEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        const { data: company, error: compErr } = await service.from('companies').insert({ name: companyName, slug, plan, installer_limit: parseInt(meta.installer_limit || '40', 10), stripe_customer_id: customerId, stripe_subscription_id: subscriptionId, subscription_status: 'trialing', default_schedule: defaultSchedule, ai_audit_enabled: true, ai_audit_trial_ends_at: trialEndsAt, trial_ends_at: trialEndsAt }).select('id').single()
        if (compErr || !company) { console.error('[webhook] company insert failed:', compErr); break }
        const { error: userErr } = await service.from('users').insert({ company_id: company.id, auth_user_id: authUserId, email: adminEmail, name: adminName, initials: getInitials(adminName), role: 'admin', is_active: true })
        if (userErr) { await service.from('companies').delete().eq('id', company.id); console.error('[webhook] user insert failed:', userErr); break }
        console.log('[webhook] provisioned company', company.id)
        break
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription
        const customerId = sub.customer as string
        const companyId = sub.metadata?.company_id
        const status: string = sub.status === 'canceled' ? 'cancelled' : sub.status
        const hasAiAudit = sub.items.data.some(
          (item) => item.price.id === AI_AUDIT_PACK.priceId
        )
        const aiAuditItem = sub.items.data.find(
          (item) => item.price.id === AI_AUDIT_PACK.priceId
        )
        const updates: Record<string, any> = {
          subscription_status: status,
          stripe_subscription_id: sub.id,
          ai_audit_enabled: hasAiAudit,
          stripe_ai_audit_subscription_item_id: aiAuditItem?.id || null,
        }
        const target = companyId
          ? service.from('companies').update(updates).eq('id', companyId)
          : service.from('companies').update(updates).eq('stripe_customer_id', customerId)
        const { error: updateErr } = await target
        if (updateErr) console.error('[webhook] subscription update failed:', updateErr)
        else console.log('[webhook] subscription updated: status=', status, 'ai_audit=', hasAiAudit)
        break
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        await service.from('companies').update({ subscription_status: 'cancelled', ai_audit_enabled: false, stripe_ai_audit_subscription_item_id: null }).eq('stripe_subscription_id', sub.id)
        break
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        await service.from('companies').update({ subscription_status: 'past_due' }).eq('stripe_customer_id', invoice.customer as string)
        break
      }
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice
        await service.from('companies').update({ subscription_status: 'active' }).eq('stripe_customer_id', invoice.customer as string)
        break
      }

    }
    return NextResponse.json({ received: true })
  } catch (err: any) {
    console.error('[webhook] handler error:', err)
    return NextResponse.json({ received: true, error: err?.message })
  }
}
