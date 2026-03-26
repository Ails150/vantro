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
    const { data: company, error: compError } = await service.from('companies').insert({ name: companyName, slug: companySlug }).select().single()
    if (compError) return NextResponse.json({ error: compError.message }, { status: 400 })
    const fullName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'Admin'
    const initials = fullName.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
    await service.from('users').insert({ company_id: company.id, email: user.email, name: fullName, initials, role: 'admin', auth_user_id: user.id })
    return NextResponse.json({ success: true })
  }
  if (step === 'installers') {
    const { installers } = body
    const { data: userData } = await service.from('users').select('company_id').eq('auth_user_id', user.id).single()
    if (!userData) return NextResponse.json({ error: 'Company not found' }, { status: 400 })
    const valid = installers.filter((i: any) => i.name && i.email)
    await service.from('users').insert(valid.map((inst: any) => ({ company_id: userData.company_id, email: inst.email, name: inst.name, initials: inst.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2), role: 'installer', is_active: true })))
    return NextResponse.json({ success: true })
  }
  if (step === 'jobs') {
    const { jobs } = body
    const { data: userData } = await service.from('users').select('company_id').eq('auth_user_id', user.id).single()
    if (!userData) return NextResponse.json({ error: 'Company not found' }, { status: 400 })
    const valid = jobs.filter((j: any) => j.name && j.address)
    if (valid.length > 0) await service.from('jobs').insert(valid.map((job: any) => ({ company_id: userData.company_id, name: job.name, address: job.address, status: 'active' })))
    return NextResponse.json({ success: true })
  }
  return NextResponse.json({ error: 'Unknown step' }, { status: 400 })
}
