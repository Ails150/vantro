import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import Stripe from 'stripe'
import { planForPriceId } from '@/lib/billing'
import { generateSlug, getInitials } from '@/lib/provisioning'
import { acceptanceColumns } from '@/lib/legal'
import { LIMITS, getClientIp, rateLimit, rateLimitedResponse } from '@/lib/rate-limit'

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured")
  return new Stripe(key)
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'


export async function POST(request: Request) {
  const ip = getClientIp(request)

  // A ceiling on the whole endpoint, set high because Stripe legitimately
  // retries and a webhook we refuse is a subscription that does not get
  // provisioned. This is not the interesting limit.
  const ceiling = await rateLimit(`webhook:stripe:ip:${ip}`, LIMITS.webhook.max, LIMITS.webhook.windowSeconds)
  if (!ceiling.allowed) return rateLimitedResponse(ceiling, LIMITS.webhook.max)

  const body = await request.text()
  const sig = request.headers.get('stripe-signature')!
  let event: Stripe.Event
  try {
    event = getStripe().webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err: any) {
    // THIS is the interesting limit. Stripe's signature never fails to verify;
    // if it is failing, either somebody is probing the endpoint or forging
    // subscription events, and both want stopping quickly rather than
    // generously. Counted only on failure, so real Stripe traffic never
    // touches this bucket however busy it gets.
    const bad = await rateLimit(
      `webhook:stripe-bad-sig:ip:${ip}`,
      LIMITS.webhookBadSignature.max,
      LIMITS.webhookBadSignature.windowSeconds,
    )
    if (!bad.allowed) return rateLimitedResponse(bad, LIMITS.webhookBadSignature.max)
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
        // When the terms were accepted, and by whom.
        //
        // Carried in the checkout metadata from /api/signup/initiate, where the
        // person actually ticked the box. Stamping new Date() here would record
        // the moment Stripe called us, which is not the moment anybody agreed
        // to anything and would be a worse answer to give a court than none.
        //
        // A session with no acceptance in its metadata predates this feature or
        // did not come from our signup page. The company is still provisioned
        // -- refusing to create a company somebody has paid for, because of a
        // missing metadata key, is the wrong failure -- but the columns stay
        // null and the compliance panel shows the gap for an admin to close.
        const acceptedAt = meta.accepted_terms_at ? new Date(meta.accepted_terms_at) : null
        const acceptance = acceptedAt && !Number.isNaN(acceptedAt.getTime())
          ? acceptanceColumns(meta.accepted_terms_by || adminName, acceptedAt)
          : {}
        if (!acceptedAt) console.warn('[webhook] no terms acceptance in checkout metadata for', companyName)

        const { data: company, error: compErr } = await service.from('companies').insert({ name: companyName, slug, plan, installer_limit: parseInt(meta.installer_limit || '40', 10), stripe_customer_id: customerId, stripe_subscription_id: subscriptionId, subscription_status: 'trialing', default_schedule: defaultSchedule, ai_audit_enabled: true, ai_audit_trial_ends_at: trialEndsAt, trial_ends_at: trialEndsAt, ...acceptance }).select('id').single()
        if (compErr || !company) { console.error('[webhook] company insert failed:', compErr); break }
        const { data: adminUser, error: userErr } = await service.from('users').insert({ company_id: company.id, auth_user_id: authUserId, email: adminEmail, name: adminName, initials: getInitials(adminName), role: 'admin', is_active: true }).select('id').single()
        if (userErr) { await service.from('companies').delete().eq('id', company.id); console.error('[webhook] user insert failed:', userErr); break }
        // Link the acceptance to the admin now that they have a row. Not fatal:
        // the name and timestamp on the company are the record.
        if (acceptedAt && adminUser?.id) {
          const { error: linkErr } = await service.from('companies').update({ dpa_accepted_by_user_id: adminUser.id }).eq('id', company.id)
          if (linkErr) console.error('[webhook] acceptance user link failed:', linkErr)
        }
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
          (item) => !!planForPriceId(item.price.id)
        )
        const aiAuditItem = sub.items.data.find(
          (item) => !!planForPriceId(item.price.id)
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
        // The period the customer paid for has now ended, so this is where a
        // cancellation actually takes effect.
        //
        // plan: 'free' is the part that was missing. Without it a cancelled
        // company kept plan: 'payroll' forever -- subscription_status said
        // 'cancelled' but every gate in the app resolves through companies.plan
        // via lib/plan.ts, so they kept payroll features indefinitely and never
        // paid again. Nothing is deleted here: the rows stay, and the free
        // retention window is applied by the nightly job, which is what lets
        // Billing promise that cancelling keeps your data.
        const sub = event.data.object as Stripe.Subscription
        await service.from('companies').update({
          plan: 'free',
          subscription_status: 'cancelled',
          ai_audit_enabled: false,
          stripe_ai_audit_subscription_item_id: null,
        }).eq('stripe_subscription_id', sub.id)
        console.log('[webhook] subscription ended, company moved to free:', sub.id)
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
