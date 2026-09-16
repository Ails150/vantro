// app/api/installer/incidents/route.ts
//
// GET  ?jobId=...  incidents on this job, so a worker can see what has already
//                  been reported rather than filing the same hazard twice.
// POST             report one (multipart: kind, description, up to 4 photos).
//
// The bar for reporting is deliberately low. Two required fields -- what kind,
// and what happened -- because a near miss that is a chore to report is a near
// miss that does not get reported, and the whole value of the record is volume.

import { NextResponse } from "next/server"
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"
import { createServiceClient } from "@/lib/supabase/server"
import { verifyActiveFieldToken } from "@/lib/auth"
import { recordFileHash, sha256Hex } from "@/lib/evidence"

const KINDS = ["near_miss", "injury", "hazard"] as const
const MAX_PHOTOS = 4
const MAX_PHOTO_BYTES = 10 * 1024 * 1024
const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"])
const R2_BUCKET = process.env.CLOUDFLARE_R2_BUCKET || "vantro-photos"

export async function GET(request: Request) {
  const installer = await verifyActiveFieldToken(request)
  if (!installer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const jobId = new URL(request.url).searchParams.get("jobId")
  const service = await createServiceClient()

  let q = service
    .from("incidents")
    .select("id, job_id, kind, description, photo_urls, occurred_at, reported_at, status, " +
            "closed_at, closure_notes, reporter:users!incidents_reported_by_fkey(name), jobs(name)")
    .eq("company_id", installer.companyId)
    .order("reported_at", { ascending: false })
    .limit(50)
  if (jobId) q = q.eq("job_id", jobId)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    incidents: (data || []).map((i: any) => ({
      id: i.id,
      jobId: i.job_id,
      jobName: i.jobs?.name || null,
      kind: i.kind,
      description: i.description,
      photoUrls: i.photo_urls || [],
      occurredAt: i.occurred_at,
      reportedAt: i.reported_at,
      reportedBy: i.reporter?.name || "Unknown",
      status: i.status,
      closedAt: i.closed_at,
      closureNotes: i.closure_notes,
    })),
  })
}

export async function POST(request: Request) {
  const installer = await verifyActiveFieldToken(request)
  if (!installer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const form = await request.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: "Expected a multipart upload" }, { status: 400 })

  const kind = String(form.get("kind") || "").trim()
  const description = String(form.get("description") || "").trim()
  const jobId = String(form.get("jobId") || "").trim()

  if (!KINDS.includes(kind as any)) {
    return NextResponse.json({ error: "Choose near miss, injury or hazard" }, { status: 400 })
  }
  if (!description) return NextResponse.json({ error: "Describe what happened" }, { status: 400 })
  if (description.length > 8000) {
    return NextResponse.json({ error: "That description is too long (8000 characters max)" }, { status: 400 })
  }
  if (!jobId) return NextResponse.json({ error: "jobId is required" }, { status: 400 })

  const service = await createServiceClient()

  const { data: job } = await service
    .from("jobs").select("id, company_id, name").eq("id", jobId).maybeSingle()
  if (!job || job.company_id !== installer.companyId) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 })
  }

  // occurred_at is theirs to set, because reporting often happens after the
  // fact. Clamped to now, and refused if it predates the job by an implausible
  // margin -- a mistyped date puts an incident in the wrong reporting period.
  const now = new Date()
  let occurredAt = now
  const occurredRaw = form.get("occurredAt")
  if (typeof occurredRaw === "string" && occurredRaw.trim()) {
    const parsed = new Date(occurredRaw)
    if (isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "occurredAt is not a valid timestamp" }, { status: 400 })
    }
    occurredAt = parsed > now ? now : parsed
    if (now.getTime() - occurredAt.getTime() > 365 * 24 * 3600 * 1000) {
      return NextResponse.json({ error: "occurredAt is more than a year ago; check the date" }, { status: 400 })
    }
  }

  const photos = form.getAll("photos").filter(p => p instanceof File) as File[]
  if (photos.length > MAX_PHOTOS) {
    return NextResponse.json({ error: `Up to ${MAX_PHOTOS} photos` }, { status: 400 })
  }

  const photoUrls: string[] = []
  const photoPaths: string[] = []

  if (photos.length > 0) {
    const { CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_R2_ACCESS_KEY_ID, CLOUDFLARE_R2_SECRET_ACCESS_KEY } = process.env
    const publicBase = (process.env.CLOUDFLARE_R2_PUBLIC_URL || "").replace(/\/$/, "")
    if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_R2_ACCESS_KEY_ID || !CLOUDFLARE_R2_SECRET_ACCESS_KEY || !publicBase) {
      return NextResponse.json({ error: "Photo storage is not configured" }, { status: 500 })
    }
    const client = new S3Client({
      region: "auto",
      endpoint: `https://${CLOUDFLARE_ACCOUNT_ID}.eu.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: CLOUDFLARE_R2_ACCESS_KEY_ID,
        secretAccessKey: CLOUDFLARE_R2_SECRET_ACCESS_KEY,
      },
    })

    for (const photo of photos) {
      const mime = (photo.type || "").split(";")[0].trim().toLowerCase()
      // Refused, not guessed -- the receipt_mime lesson. An incident photo
      // filed under the wrong type is a photo nobody can open in an
      // investigation.
      if (!ACCEPTED.has(mime)) {
        return NextResponse.json(
          { error: `Photos must be JPEG, PNG, WebP or HEIC. Got ${mime ? `"${mime}"` : "a file with no type"}.` },
          { status: 400 },
        )
      }
      if (photo.size > MAX_PHOTO_BYTES) {
        return NextResponse.json({ error: "Each photo must be under 10MB" }, { status: 400 })
      }
      const bytes = Buffer.from(await photo.arrayBuffer())
      const sha = sha256Hex(bytes)
      const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : mime.includes("hei") ? "heic" : "jpg"
      const key = `incidents/${installer.companyId}/${jobId}/${sha.slice(0, 16)}.${ext}`
      await client.send(new PutObjectCommand({
        Bucket: R2_BUCKET, Key: key, Body: bytes, ContentType: mime,
        Metadata: { "company-id": installer.companyId, "job-id": jobId },
      }))
      await recordFileHash({
        companyId: installer.companyId,
        storagePath: key,
        sha256: sha,
        hashedBy: installer.userId,
      })
      photoPaths.push(key)
      photoUrls.push(`${publicBase}/${key}`)
    }
  }

  const num = (v: FormDataEntryValue | null) => {
    const n = typeof v === "string" ? Number(v) : NaN
    return Number.isFinite(n) ? n : null
  }

  const { data: incident, error } = await service
    .from("incidents")
    .insert({
      company_id: installer.companyId,
      job_id: jobId,
      reported_by: installer.userId,
      kind,
      description,
      photo_urls: photoUrls,
      photo_paths: photoPaths,
      occurred_at: occurredAt.toISOString(),
      lat: num(form.get("lat")),
      lng: num(form.get("lng")),
      accuracy_metres: num(form.get("accuracy")) != null ? Math.round(num(form.get("accuracy"))!) : null,
    })
    .select("id, reported_at")
    .single()

  if (error) {
    console.error("[incidents] insert failed", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Put it in front of an admin now. An incident that waits for someone to
  // open a tab is an incident nobody acted on, and an injury is urgency 3.
  const { error: alertErr } = await service.from("alerts").insert({
    company_id: installer.companyId,
    job_id: jobId,
    user_id: installer.userId,
    alert_type: kind === "injury" ? "blocker" : "issue",
    message:
      `${kind === "near_miss" ? "Near miss" : kind === "injury" ? "Injury" : "Hazard"} reported at ` +
      `${job.name}: ${description.slice(0, 160)}`,
    status: "open",
    urgency: kind === "injury" ? 3 : 2,
    is_read: false,
  })
  if (alertErr) console.error("[incidents] alert insert failed", alertErr)

  console.log("[incidents]", kind, "reported on", jobId, "by", installer.userId)
  return NextResponse.json({ success: true, id: incident.id, reportedAt: incident.reported_at })
}
