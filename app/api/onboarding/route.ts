import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const body = await request.json()
  const { step } = body

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = await createServiceClient()

  if (step === 'company') {
    const { companyName, companySlug } = body

    // Create company
    const { data: company, error: compError } = await service
      .from('companies')
      .insert({ name: companyName, slug: companySlug })
      .select()
      .single()

    if (compError) return NextResponse.json({ error: compError.message }, { status: 400 })

    // Create admin user record
    const initials = companyName.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
    await service.from('users').insert({
      company_id: company.id,
      email: user.email,
      name: user.email?.split('@')[0] || 'Admin',
      initials,
      role: 'admin',
      auth_user_id: user.id
    })

    return NextResponse.json({ success: true, companyId: company.id })
  }

  if (step === 'installers') {
    const { installers } = body

    // Get company for this user
    const { data: userData } = await service
      .from('users')
      .select('company_id')
      .eq('auth_user_id', user.id)
      .single()

    if (!userData) return NextResponse.json({ error: 'Company not found' }, { status: 400 })

    const insertData = installers.map((inst: any) => ({
      company_id: userData.company_id,
      email: inst.email,
      name: inst.name,
      initials: inst.initials || inst.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2),
      role: 'installer',
    }))

    const { error } = await service.from('users').insert(insertData)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({ success: true })
  }

  if (step === 'jobs') {
    const { jobs } = body

    const { data: userData } = await service
      .from('users')
      .select('company_id')
      .eq('auth_user_id', user.id)
      .single()

    if (!userData) return NextResponse.json({ error: 'Company not found' }, { status: 400 })

    if (jobs && jobs.length > 0) {
      const insertData = jobs.map((job: any) => ({
        company_id: userData.company_id,
        name: job.name,
        address: job.address,
        status: 'active',
        created_by: user.id,
      }))
      await service.from('jobs').insert(insertData)
    }

    // Mark onboarding complete
    await service
      .from('companies')
      .update({ plan: 'trial' })
      .eq('id', userData.company_id)

    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Unknown step' }, { status: 400 })
}
