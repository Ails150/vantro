import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import Stripe from 'stripe'

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured")
  return new Stripe(key)
}

const isValidStripeCustomerId = (id: string | null | undefined): boolean => {
  if (!id) return false
  return /^cus_[A-Za-z0-9]{14,}$/.test(id) && !id.includes('TBD')
}

export async function POST() {
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
    return NextResponse.json({ error: 'Only admins can manage billing' }, { status: 403 })
  }

  const { data: company } = await service
    .from('companies')
    .select('id, name, stripe_customer_id')
    .eq('id', userData.company_id)
    .single()
  if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.getvantro.com'

  let customerId = company.stripe_customer_id
  if (!isValidStripeCustomerId(customerId)) {
    const customer = await getStripe().customers.create({
      email: user.email,
      name: company.name,
      metadata: { company_id: company.id },
    })
    customerId = customer.id
    await service
      .from('companies')
      .update({ stripe_customer_id: customerId })
      .eq('id', company.id)
  }

  try {
    const portalSession = await getStripe().billingPortal.sessions.create({
      customer: customerId!,
      return_url: `${appUrl}/admin/settings`,
    })
    return NextResponse.json({ url: portalSession.url })
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Could not open billing portal', detail: err?.message || String(err) },
      { status: 500 }
    )
  }
}
