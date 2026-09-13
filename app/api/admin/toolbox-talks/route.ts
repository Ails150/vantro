// app/api/admin/toolbox-talks/route.ts
//
// GET  ?jobId=...  list talks with, for each, who has signed and who has not.
// POST             raise a talk against a job.
//
// The list is the point of the feature. "Who has NOT signed" is the question an
// admin actually has, and it cannot be answered from the signatures table alone
// -- an absence is only meaningful against the crew assigned to that job. So the
// outstanding list is computed here from job_assignments minus signatures.

import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

const MANAGER_ROLES = ["admin", "foreman", "superadmin"]

async function caller() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  const service = await createServiceClient()
  const { data: me } = await service
    .from("users")
    .select("id, company_id, role")
    .eq("auth_user_id", user.id)
    .single()
  if (!me || !MANAGER_ROLES.includes(me.role)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }
  return { me, service }
}

export async function GET(request: Request) {
  const c = await caller()
  if ("error" in c) return c.error
  const { me, service } = c

  const jobId = new URL(request.url).searchParams.get("jobId")

  let q = service
    .from("toolbox_talks")
    .select(
      "id, job_id, title, notes, document_url, document_path, delivered_at, locked_at, archived_at, created_at, " +
        "jobs(id, name), delivered_by_user:users!toolbox_talks_delivered_by_fkey(id, name)",
    )
    .eq("company_id", me.company_id)
    .is("archived_at", null)
    .order("delivered_at", { ascending: false })
    .limit(200)
  if (jobId) q = q.eq("job_id", jobId)

  const { data: talks, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!talks || talks.length === 0) return NextResponse.json({ talks: [] })

  const talkIds = talks.map((t: any) => t.id)
  const jobIds = [...new Set(talks.map((t: any) => t.job_id))]

  const { data: signatures } = await service
    .from("toolbox_talk_signatures")
    .select("id, talk_id, user_id, signed_at, lat, lng, users(id, name)")
    .in("talk_id", talkIds)

  // The crew each talk was for. Someone assigned to the job after the briefing
  // was given still shows as outstanding, which is correct: they have not had
  // the briefing.
  const { data: assignments } = await service
    .from("job_assignments")
    .select("job_id, user_id, users(id, name, is_active)")
    .in("job_id", jobIds)

  const crewByJob = new Map<string, Array<{ id: string; name: string }>>()
  for (const a of assignments || []) {
    const u = a.users as any
    if (!u || u.is_active === false) continue
    const list = crewByJob.get(a.job_id) || []
    list.push({ id: u.id, name: u.name })
    crewByJob.set(a.job_id, list)
  }

  const signedByTalk = new Map<string, any[]>()
  for (const s of signatures || []) {
    const list = signedByTalk.get(s.talk_id) || []
    list.push(s)
    signedByTalk.set(s.talk_id, list)
  }

  const out = talks.map((t: any) => {
    const signed = signedByTalk.get(t.id) || []
    const signedIds = new Set(signed.map(s => s.user_id))
    const crew = crewByJob.get(t.job_id) || []
    const outstanding = crew.filter(m => !signedIds.has(m.id))
    return {
      id: t.id,
      jobId: t.job_id,
      jobName: t.jobs?.name || null,
      title: t.title,
      notes: t.notes,
      documentUrl: t.document_url,
      deliveredAt: t.delivered_at,
      deliveredBy: t.delivered_by_user?.name || null,
      locked: !!t.locked_at,
      signed: signed
        .map(s => ({
          userId: s.user_id,
          name: (s.users as any)?.name || "Unknown",
          signedAt: s.signed_at,
          hasLocation: s.lat != null && s.lng != null,
        }))
        .sort((a, b) => (a.signedAt || "").localeCompare(b.signedAt || "")),
      outstanding: outstanding.sort((a, b) => a.name.localeCompare(b.name)),
      crewSize: crew.length,
    }
  })

  return NextResponse.json({ talks: out })
}

export async function POST(request: Request) {
  const c = await caller()
  if ("error" in c) return c.error
  const { me, service } = c

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  const title = String(body.title || "").trim()
  const jobId = String(body.jobId || "").trim()
  const notes = body.notes ? String(body.notes).trim() : null

  if (!title) return NextResponse.json({ error: "Give the talk a title" }, { status: 400 })
  if (title.length > 200) return NextResponse.json({ error: "Title is too long (200 characters max)" }, { status: 400 })
  if (!jobId) return NextResponse.json({ error: "Pick a job" }, { status: 400 })
  if (notes && notes.length > 8000) {
    return NextResponse.json({ error: "Notes are too long (8000 characters max)" }, { status: 400 })
  }

  // The job must be this company's. Without this an admin could attach a safety
  // record to another tenant's job by posting its id.
  const { data: job } = await service
    .from("jobs")
    .select("id, company_id")
    .eq("id", jobId)
    .maybeSingle()
  if (!job || job.company_id !== me.company_id) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 })
  }

  const deliveredAt = body.deliveredAt ? new Date(body.deliveredAt) : new Date()
  if (isNaN(deliveredAt.getTime())) {
    return NextResponse.json({ error: "deliveredAt is not a valid date" }, { status: 400 })
  }
  if (deliveredAt.getTime() > Date.now() + 60 * 60 * 1000) {
    return NextResponse.json({ error: "A talk cannot be delivered in the future" }, { status: 400 })
  }

  const { data: talk, error } = await service
    .from("toolbox_talks")
    .insert({
      company_id: me.company_id,
      job_id: jobId,
      title,
      notes,
      document_url: body.documentUrl || null,
      document_path: body.documentPath || null,
      document_sha256: body.documentSha256 || null,
      delivered_by: body.deliveredBy || me.id,
      delivered_at: deliveredAt.toISOString(),
      created_by: me.id,
    })
    .select("id")
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  console.log("[toolbox-talks] raised", talk.id, "job", jobId, "by", me.id)
  return NextResponse.json({ success: true, id: talk.id })
}
