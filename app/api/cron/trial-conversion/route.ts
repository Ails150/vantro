// app/api/cron/trial-conversion/route.ts
// Runs daily via Vercel Cron at 23:30 UTC.
// Processes companies whose trial ends in the next ~24 hours.
// 
// For each company:
//   - If card on file + tier selected -> create Stripe subscription
//   - If charge fails -> mark past_due
//   - If no card -> do nothing (will fall through to read-only mode tomorrow)
//
// Reminder emails are sent at days 28 and 29 (separate cron logic in same handler).
//
// Idempotency: companies.last_conversion_attempt prevents duplicate charges.
// Auth: Vercel cron sends Authorization: Bearer <CRON_SECRET>

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import Stripe from 'stripe'
import { TIERS } from '@/lib/billing'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

export async function GET(request: Request) {
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const service = await createServiceClient()
  const now = new Date()
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000)

  const results: any[] = []

  // ============ EMAIL REMINDERS ============
  // Day 28 (48h left): first warning email
  // Day 29 (24h left): second warning email
  const { data: companiesNearExpiry } = await service
    .from('companies')
    .select('id, name, billing_email, trial_ends_at, last_trial_email_day, current_plan, stripe_customer_id, subscription_status')
    .eq('subscription_status', 'trial')
    .gte('trial_ends_at', now.toISOString())
    .lte('trial_ends_at', in48h.toISOString())

  for (const c of companiesNearExpiry || []) {
    const trialEnds = new Date(c.trial_ends_at)
    const hoursLeft = Math.floor((trialEnds.getTime() - now.getTime()) / (60 * 60 * 1000))
    const dayBucket = hoursLeft <= 24 ? 29 : 28

    if (c.last_trial_email_day === dayBucket) continue // already sent

    const adminEmail = c.billing_email || await getAdminEmail(service, c.id)
    if (!adminEmail) continue

    try {
      await sendReminderEmail(adminEmail, c.name, hoursLeft, c.stripe_customer_id != null)
      await service.from('companies')
        .update({ last_trial_email_day: dayBucket })
        .eq('id', c.id)
      results.push({ id: c.id, action: 'email_sent', day: dayBucket, hoursLeft })
    } catch (err: any) {
      results.push({ id: c.id, action: 'email_error', error: err?.message || String(err) })
    }
  }

  // ============ AUTO-CONVERSION (DAY 30) ============
  // Companies whose trial ends within the next 24 hours.
  const { data: expiring } = await service
    .from('companies')
    .select('id, name, trial_ends_at, current_plan, stripe_customer_id, stripe_subscription_id, subscription_status, billing_email, last_conversion_attempt')
    .eq('subscription_status', 'trial')
    .lte('trial_ends_at', in24h.toISOString())
    .gte('trial_ends_at', now.toISOString())

  for (const c of expiring || []) {
    // Idempotency: skip if already attempted in last 12h
    if (c.last_conversion_attempt) {
      const lastAttempt = new Date(c.last_conversion_attempt)
      if (now.getTime() - lastAttempt.getTime() < 12 * 60 * 60 * 1000) {
        results.push({ id: c.id, action: 'skipped_recent_attempt' })
        continue
      }
    }

    if (!c.stripe_customer_id) {
      results.push({ id: c.id, action: 'no_card_skipped' })
      continue
    }

    if (!c.current_plan || !TIERS[c.current_plan as keyof typeof TIERS]) {
      results.push({ id: c.id, action: 'no_plan_skipped' })
      continue
    }

    // Mark attempt before doing anything
    await service.from('companies')
      .update({ last_conversion_attempt: now.toISOString() })
      .eq('id', c.id)

    const tier = TIERS[c.current_plan as keyof typeof TIERS]

    try {
      const subscription = await stripe.subscriptions.create({
        customer: c.stripe_customer_id,
        items: [{ price: tier.priceId }],
        metadata: {
          company_id: c.id,
          plan: c.current_plan,
          installer_limit: String(tier.installerLimit),
          source: 'auto_conversion',
        },
        payment_behavior: 'default_incomplete',
        payment_settings: { save_default_payment_method: 'on_subscription' },
        expand: ['latest_invoice.payment_intent'],
      })

      // Webhook will update DB when payment succeeds. But mark optimistically here.
      // If charge fails Stripe will fire invoice.payment_failed -> webhook sets past_due.
      results.push({ id: c.id, action: 'subscription_created', subscriptionId: subscription.id, status: subscription.status })

      // Send confirmation email
      const adminEmail = c.billing_email || await getAdminEmail(service, c.id)
      if (adminEmail) {
        await sendConversionEmail(adminEmail, c.name, tier.name, tier.price)
      }
    } catch (err: any) {
      results.push({ id: c.id, action: 'subscription_error', error: err?.message || String(err) })

      // Mark as past_due so they fall into read-only mode
      await service.from('companies')
        .update({ subscription_status: 'past_due' })
        .eq('id', c.id)
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results })
}

async function getAdminEmail(service: any, companyId: string): Promise<string | null> {
  const { data } = await service.from('users')
    .select('email')
    .eq('company_id', companyId)
    .eq('role', 'admin')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return data?.email || null
}

async function sendReminderEmail(to: string, companyName: string, hoursLeft: number, hasCard: boolean) {
  if (!process.env.RESEND_API_KEY) return
  const subject = hoursLeft <= 24
    ? 'Your Vantro trial ends tomorrow'
    : 'Your Vantro trial ends in 48 hours'
  const cta = hasCard
    ? 'Your card is on file. We will charge it tomorrow at midnight to keep your account active.'
    : 'Add a card to your account to keep working without interruption.'
  const html = `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
    <div style="background:#00C896;width:40px;height:40px;border-radius:8px;display:flex;align-items:center;justify-content:center;margin-bottom:24px">
      <span style="color:#07100D;font-weight:800;font-size:1rem">V</span>
    </div>
    <h2 style="color:#0A1A14;font-size:1.4rem;margin-bottom:12px">${subject}</h2>
    <p style="color:#4A6158;line-height:1.6">Hi ${companyName} team,</p>
    <p style="color:#4A6158;line-height:1.6">${cta}</p>
    <p style="margin-top:24px"><a href="https://app.getvantro.com/admin" style="display:inline-block;background:#00C896;color:#07100D;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">Open Vantro</a></p>
    <p style="color:#888;font-size:12px;margin-top:24px">Vantro · getvantro.com</p>
  </div>`
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Vantro <noreply@getvantro.com>', to, subject, html })
  })
}

async function sendConversionEmail(to: string, companyName: string, planName: string, planPrice: number) {
  if (!process.env.RESEND_API_KEY) return
  const html = `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
    <div style="background:#00C896;width:40px;height:40px;border-radius:8px;display:flex;align-items:center;justify-content:center;margin-bottom:24px">
      <span style="color:#07100D;font-weight:800;font-size:1rem">V</span>
    </div>
    <h2 style="color:#0A1A14;font-size:1.4rem;margin-bottom:12px">Welcome to Vantro ${planName}</h2>
    <p style="color:#4A6158;line-height:1.6">Hi ${companyName} team,</p>
    <p style="color:#4A6158;line-height:1.6">Your trial ended and your subscription is now active on the <strong>${planName}</strong> plan at <strong>£${planPrice}/month</strong>.</p>
    <p style="color:#4A6158;line-height:1.6">Manage billing or change plan anytime via your admin dashboard.</p>
    <p style="margin-top:24px"><a href="https://app.getvantro.com/admin" style="display:inline-block;background:#00C896;color:#07100D;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">Open Vantro</a></p>
    <p style="color:#888;font-size:12px;margin-top:24px">Vantro · getvantro.com</p>
  </div>`
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Vantro <noreply@getvantro.com>', to, subject: `Welcome to Vantro ${planName}`, html })
  })
}
