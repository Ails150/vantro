import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"
import crypto from "crypto"

// /api/audit/share
//   POST → create a share link, body: { jobId, from?, to? }
//   GET  → list active shares for a job, query: ?jobId=...

const EXPIRY_DAYS = 30

function getBaseUrl(req: Request): string {
  const host = req.headers.get("host")
  const proto = req.headers.get("x-forwarded-proto") || "https"
  return `${proto}://${host}`
}

async function getAdmin(authUserId: string) {
  const service = await createServiceClient()
  const { data } = await service
    .from("users")
    .select("id, company_id, role")
    .eq("auth_user_id", authUserId)
    .single()
  return { service, admin: data }
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { service, admin } = await getAdmin(user.id)
  if (!admin || admin.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const { jobId, from, to } = body
  if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 })

  // Verify job belongs to admin's company
  const { data: job } = await service.from("jobs").select("id, company_id").eq("id", jobId).single()
  if (!job || job.company_id !== admin.company_id) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 })
  }

  // Generate cryptographically secure token (32 bytes → URL-safe base64)
  const token = crypto.randomBytes(32).toString("base64url")
  const expiresAt = new Date(Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data: share, error } = await service
    .from("audit_shares")
    .insert({
      company_id: admin.company_id,
      job_id: jobId,
      created_by: admin.id,
      token,
      date_from: from || null,
      date_to: to || null,
      expires_at: expiresAt,
    })
    .select("id, token, expires_at, created_at")
    .single()

  if (error || !share) {
    return NextResponse.json({ error: error?.message || "Could not create link" }, { status: 500 })
  }

  const url = `${getBaseUrl(request)}/audit/${token}`
  return NextResponse.json({ id: share.id, url, expires_at: share.expires_at })
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { service, admin } = await getAdmin(user.id)
  if (!admin || admin.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const jobId = searchParams.get("jobId")
  if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 })

  const { data, error } = await service
    .from("audit_shares")
    .select("id, token, date_from, date_to, expires_at, view_count, last_viewed_at, created_at")
    .eq("company_id", admin.company_id)
    .eq("job_id", jobId)
    .eq("revoked", false)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const baseUrl = getBaseUrl(request)
  const shares = (data || []).map((s: any) => ({
    ...s,
    url: `${baseUrl}/audit/${s.token}`,
  }))

  return NextResponse.json({ shares })
}
