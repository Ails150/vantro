import { verifyInstallerToken } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const installer = verifyInstallerToken(request)
  if (!installer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const jobId = searchParams.get('jobId')
  if (!jobId) return NextResponse.json({ error: 'Missing jobId' }, { status: 400 })

  const service = await createServiceClient()

  // Get installer's company
  const { data: userRow } = await service
    .from('users')
    .select('company_id')
    .eq('id', installer.userId)
    .single()
  if (!userRow?.company_id) return NextResponse.json({ error: 'No company' }, { status: 403 })

  // Get templates already assigned to this job (to exclude from library)
  const { data: assigned } = await service
    .from('job_checklists')
    .select('template_id')
    .eq('job_id', jobId)
  const assignedIds = new Set((assigned || []).map((a: any) => a.template_id))

  // Get all non-audit-only templates for the company
  const { data: templates } = await service
    .from('checklist_templates')
    .select('id, name, requires_approval, audit_only, frequency, checklist_items(*)')
    .eq('company_id', userRow.company_id)
    .eq('audit_only', false)
    .order('name')

  // Exclude already-assigned
  const library = (templates || [])
    .filter((t: any) => !assignedIds.has(t.id))
    .map((t: any) => ({
      ...t,
      items: (t.checklist_items || []).sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
    }))

  return NextResponse.json({ library })
}