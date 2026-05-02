import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import Stripe from 'stripe'
import { TIERS } from '@/lib/billing'

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured")
  return new Stripe(key)
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const service = await createServiceClient()

  const { data: userData } = await service
    .from('users')
    .select('company_id, role')
    .eq('auth_user_id', user.id)
    .single()
  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const { data: company } = await service
    .from('companies')
    .select('id, name, plan, installer_limit, subscription_status, trial_ends_at, stripe_subscription_id, stripe_customer_id')
    .eq('id', userData.company_id)
    .single()
  if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

  const { count: installerCount } = await service
    .from('users')
    .select('*', { count: 'exact', head: true })
    .eq('company_id', company.id)
    .eq('role', 'installer')
    .eq('is_active', true)

  let subscription: any = null
  if (company.stripe_subscription_id) {
    try {
      const sub: any = await getStripe().subscriptions.retrieve(company.stripe_subscription_id)
      subscription = {
        status: sub.status,
        current_period_end: sub.current_period_end,
        cancel_at_period_end: sub.cancel_at_period_end,
        cancel_at: sub.cancel_at,
        canceled_at: sub.canceled_at,
        trial_end: sub.trial_end,
      }
    } catch (err) {}
  }

  let trialDaysRemaining: number | null = null
  if (company.trial_ends_at && company.subscription_status === 'trial') {
    const end = new Date(company.trial_ends_at).getTime()
    const now = Date.now()
    trialDaysRemaining = Math.max(0, Math.ceil((end - now) / 86400000))
  }

  const currentTier = company.plan ? (TIERS as any)[company.plan] : null

  return NextResponse.json({
    company: { id: company.id, name: company.name },
    plan: {
      key: company.plan,
      name: currentTier?.name || 'No plan',
      price: currentTier?.price || 0,
      installerLimit: company.installer_limit || currentTier?.installerLimit || 0,
    },
    usage: { installers: installerCount || 0 },
    subscription: {
      status: company.subscription_status,
      trialDaysRemaining,
      stripe: subscription,
    },
    role: userData.role,
    tiers: Object.entries(TIERS).map(([key, t]: any) => ({
      key,
      name: t.name,
      price: t.price,
      installerLimit: t.installerLimit,
    })),
  })
}
