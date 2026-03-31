import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const body = await request.json()
  const { step } = body

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = await createServiceClient()

  if (step === 'company') {
    const { companyName, companySlug } = body
    if (!companyName) return NextResponse.json({ error: 'Company name required' }, { status: 400 })

    const { data: existingUser } = await service
      .from('users')
      .select('company_id')
      .eq('auth_user_id', user.id)
      .single()

    if (existingUser?.company_id) {
      return NextResponse.json({ success: true, companyId: existingUser.company_id })
    }

    const { data: company, error: compError } = await service
      .from('companies')
      .insert({ name: companyName, slug: companySlug })
      .select()
      .single()

    if (compError) return NextResponse.json({ error: compError.message }, { status: 400 })

    const fullName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'Admin'
    const initials = fullName.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)

    const { error: userError } = await service.from('users').insert({
      company_id: company.id,
      email: user.email,
      name: fullName,
      initials,
      role: 'admin',
      auth_user_id: user.id
    })

    if (userError) return NextResponse.json({ error: userError.message }, { status: 400 })
    return NextResponse.json({ success: true, companyId: company.id })
  }

  if (step === 'installers') {
    const { installers } = body
    let { data: userData } = await service.from('users').select('company_id').eq('auth_user_id', user.id).single()
    if (!userData) {
      const companyName = user.user_metadata?.company_name || 'My Company'
      const slug = companyName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) + '_' + Math.random().toString(36).slice(2, 6)
      const { data: company } = await service.from('companies').insert({ name: companyName, slug }).select().single()
      if (!company) return NextResponse.json({ error: 'Could not create company' }, { status: 400 })
      const fullName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'Admin'
      const initials = fullName.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
      await service.from('users').insert({ company_id: company.id, email: user.email, name: fullName, initials, role: 'admin', auth_user_id: user.id })
      const { data: newUser } = await service.from('users').select('company_id').eq('auth_user_id', user.id).single()
      userData = newUser
    }
    if (!userData) return NextResponse.json({ error: 'Company not found' }, { status: 400 })

    const valid = installers.filter((i: any) => i.name && i.email)
    if (!valid.length) return NextResponse.json({ error: 'Add at least one installer' }, { status: 400 })

    const insertData = valid.map((inst: any) => ({
      company_id: userData.company_id,
      email: inst.email,
      name: inst.name,
      initials: inst.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2),
      role: inst.role || 'installer',
      is_active: true,
    }))

    const { error } = await service.from('users').insert(insertData)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true })
  }

  if (step === 'jobs') {
    const { jobs } = body
    const { data: userData } = await service.from('users').select('company_id').eq('auth_user_id', user.id).single()
    if (!userData) return NextResponse.json({ error: 'Company not found' }, { status: 400 })

    if (jobs && jobs.length > 0) {
      const valid = jobs.filter((j: any) => j.name && j.address)
      if (valid.length > 0) {
        await service.from('jobs').insert(valid.map((job: any) => ({
          company_id: userData.company_id,
          name: job.name,
          address: job.address,
          status: 'active',
        })))
      }
    }
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Unknown step' }, { status: 400 })
}
