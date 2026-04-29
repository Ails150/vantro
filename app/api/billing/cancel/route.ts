import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const service = await createServiceClient()

  const { data: userData } = await service
    .from('users')
    .select('company_id, role')
    .eq('auth_user_id', user.id)
    .single()
  if (!userData || userData.role !== 'admin') {
    return NextResponse.json({ error: 'Only admins can cancel billing' }, { status: 403 })
  }

  const { data: company } = await service
    .from('companies')
    .select('id, stripe_subscription_id')
    .eq('id', userData.company_id)
    .single()
  if (!company?.stripe_subscription_id) {
    return NextResponse.json({ error: 'No active subscription' }, { status: 400 })
  }

  // Determine action — cancel or undo cancel
  let action: 'cancel' | 'undo' = 'cancel'
  try {
    const body = await request.json()
    if (body?.action === 'undo') action = 'undo'
  } catch {}

  try {
    const sub = await stripe.subscriptions.update(company.stripe_subscription_id, {
      cancel_at_period_end: action === 'cancel',
    })

    return NextResponse.json({
      success: true,
      cancel_at_period_end: sub.cancel_at_period_end,
      cancel_at: sub.cancel_at,
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Could not update subscription', detail: err?.message || String(err) },
      { status: 500 }
    )
  }
}
