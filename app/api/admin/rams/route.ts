// app/api/admin/rams/route.ts
//
// GET  ?jobId=...  the RAMS history for a job, and who has signed the current
//                  version.
// POST             upload a new version (multipart: file, jobId, title, notes).
//
// Uploading a revision supersedes the previous version rather than replacing
// it. Nothing is ever overwritten: the old document, its hash and its
// signatures stay exactly as they were, because "who signed what, when" is the
// question this table exists to answer and a revision must not rewrite history.

import { NextResponse } from "next/server"
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"
import { createClient, createServiceClient } from "@/lib/supabase/server"
import { recordFileHash, sha256Hex } from "@/lib/evidence"

const MANAGER_ROLES = ["admin", "foreman", "superadmin"]
const MAX_BYTES = 20 * 1024 * 1024
const R2_BUCKET = process.env.CLOUDFLARE_R2_BUCKET || "vantro-photos"

async function caller() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  const service = await createServiceClient()
  const { data: me } = await service
    .from("users").select("id, company_id, role").eq("auth_user_id", user.id).single()
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
  if (!jobId) return NextResponse.json({ error: "jobId is required" }, { status: 400 })

  // Typed as any: supabase-js cannot infer the shape of an aliased embed
  // (uploaded_by_user:users!fk) and falls back to an error type, which then
  // poisons every property read below.
  const { data: versions, error } = (await service
    .from("rams_documents")
    .select(
      "id, version, title, notes, document_url, document_sha256, document_bytes, created_at, " +
        "superseded_at, archived_at, uploaded_by_user:users!rams_documents_uploaded_by_fkey(name)",
    )
    .eq("company_id", me.company_id)
    .eq("job_id", jobId)
    .order("version", { ascending: false })) as { data: any[] | null; error: any }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const current = (versions || []).find((v: any) => !v.superseded_at && !v.archived_at) || null

  // Who is on the job, and of those, who has signed the version in force. An
  // outstanding name is only meaningful against the assigned crew.
  const { data: crewRows } = await service
    .from("job_assignments")
    .select("user_id, users(id, name, is_active)")
    .eq("job_id", jobId)
  const crew = (crewRows || [])
    .map((a: any) => a.users)
    .filter((u: any) => u && u.is_active !== false)

  let signed: any[] = []
  if (current) {
    const { data: sigs } = await service
      .from("rams_signatures")
      .select("user_id, signed_at, read_seconds, lat, lng, users(id, name)")
      .eq("rams_id", current.id)
    signed = (sigs || []).map((s: any) => ({
      userId: s.user_id,
      name: s.users?.name || "Unknown",
      signedAt: s.signed_at,
      readSeconds: s.read_seconds,
      hasLocation: s.lat != null && s.lng != null,
    }))
  }
  const signedIds = new Set(signed.map(s => s.userId))

  return NextResponse.json({
    current: current
      ? {
          id: current.id,
          version: current.version,
          title: current.title,
          notes: current.notes,
          documentUrl: current.document_url,
          sha256: current.document_sha256,
          bytes: current.document_bytes,
          createdAt: current.created_at,
          uploadedBy: current.uploaded_by_user?.name || null,
        }
      : null,
    history: (versions || []).map((v: any) => ({
      id: v.id,
      version: v.version,
      title: v.title,
      documentUrl: v.document_url,
      createdAt: v.created_at,
      supersededAt: v.superseded_at,
      uploadedBy: v.uploaded_by_user?.name || null,
    })),
    signed: signed.sort((a, b) => (a.signedAt || "").localeCompare(b.signedAt || "")),
    outstanding: crew
      .filter((u: any) => !signedIds.has(u.id))
      .map((u: any) => ({ id: u.id, name: u.name }))
      .sort((a: any, b: any) => a.name.localeCompare(b.name)),
    crewSize: crew.length,
  })
}

export async function POST(request: Request) {
  const c = await caller()
  if ("error" in c) return c.error
  const { me, service } = c

  const form = await request.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: "Expected a multipart upload" }, { status: 400 })

  const file = form.get("document") as File | null
  const jobId = String(form.get("jobId") || "").trim()
  const title = String(form.get("title") || "").trim()
  const notes = (form.get("notes") as string | null)?.trim() || null

  if (!file) return NextResponse.json({ error: "Attach the RAMS PDF" }, { status: 400 })
  if (!jobId) return NextResponse.json({ error: "Pick a job" }, { status: 400 })
  if (!title) return NextResponse.json({ error: "Give the document a title" }, { status: 400 })
  if (title.length > 200) return NextResponse.json({ error: "Title is too long (200 max)" }, { status: 400 })

  // PDF only, and refused rather than guessed -- the same rule the receipt
  // upload learned. A method statement filed under the wrong type is a document
  // nobody can open when it matters.
  const mime = (file.type || "").split(";")[0].trim().toLowerCase()
  if (mime !== "application/pdf") {
    return NextResponse.json(
      { error: `The RAMS must be a PDF. Got ${mime ? `"${mime}"` : "a file with no type"}.` },
      { status: 400 },
    )
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `That PDF is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is 20MB.` },
      { status: 400 },
    )
  }

  const { data: job } = await service
    .from("jobs").select("id, company_id").eq("id", jobId).maybeSingle()
  if (!job || job.company_id !== me.company_id) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 })
  }

  const bytes = Buffer.from(await file.arrayBuffer())
  const sha = sha256Hex(bytes)

  const { CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_R2_ACCESS_KEY_ID, CLOUDFLARE_R2_SECRET_ACCESS_KEY } = process.env
  const publicBase = (process.env.CLOUDFLARE_R2_PUBLIC_URL || "").replace(/\/$/, "")
  if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_R2_ACCESS_KEY_ID || !CLOUDFLARE_R2_SECRET_ACCESS_KEY || !publicBase) {
    return NextResponse.json({ error: "File storage is not configured" }, { status: 500 })
  }

  const { data: latest } = await service
    .from("rams_documents")
    .select("id, version")
    .eq("job_id", jobId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextVersion = (latest?.version || 0) + 1

  // Keyed by content hash so re-uploading the identical file does not create a
  // second object, and the key itself is a claim about the bytes.
  const key = `rams/${me.company_id}/${jobId}/v${nextVersion}-${sha.slice(0, 16)}.pdf`
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${CLOUDFLARE_ACCOUNT_ID}.eu.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: CLOUDFLARE_R2_ACCESS_KEY_ID,
      secretAccessKey: CLOUDFLARE_R2_SECRET_ACCESS_KEY,
    },
  })
  await client.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: bytes,
    ContentType: "application/pdf",
    Metadata: { "company-id": me.company_id, "job-id": jobId, version: String(nextVersion) },
  }))
  await recordFileHash({ companyId: me.company_id, storagePath: key, sha256: sha, hashedBy: me.id })

  // Retire the outgoing version FIRST. The partial unique index allows exactly
  // one live version per job, so doing it the other way round would fail -- and
  // that is the constraint doing its job rather than an ordering quirk to work
  // around.
  if (latest) {
    const { error: supErr } = await service
      .from("rams_documents")
      .update({ superseded_at: new Date().toISOString() })
      .eq("id", latest.id)
      .is("superseded_at", null)
    if (supErr) {
      console.error("[rams] could not supersede previous version", supErr)
      return NextResponse.json({ error: "Could not retire the previous version" }, { status: 500 })
    }
  }

  const { data: doc, error: insErr } = await service
    .from("rams_documents")
    .insert({
      company_id: me.company_id,
      job_id: jobId,
      version: nextVersion,
      title,
      notes,
      document_path: key,
      document_url: `${publicBase}/${key}`,
      document_sha256: sha,
      document_bytes: bytes.byteLength,
      uploaded_by: me.id,
    })
    .select("id, version")
    .single()

  if (insErr) {
    // The outgoing version is already retired. Put it back rather than leaving
    // the job with no RAMS in force, which would silently open the sign-in gate.
    if (latest) {
      await service.from("rams_documents").update({ superseded_at: null }).eq("id", latest.id)
    }
    console.error("[rams] insert failed", insErr)
    return NextResponse.json({ error: insErr.message }, { status: 500 })
  }

  // Point the retired row at its replacement, for the history view. Best
  // effort: the chain is already readable by version number.
  if (latest) {
    await service.from("rams_documents").update({ superseded_by: doc.id }).eq("id", latest.id)
  }

  console.log("[rams] version", doc.version, "uploaded for job", jobId, "by", me.id)
  return NextResponse.json({
    success: true,
    id: doc.id,
    version: doc.version,
    supersededPrevious: !!latest,
  })
}
