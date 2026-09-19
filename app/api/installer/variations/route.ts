// app/api/installer/variations/route.ts
//
// GET  ?jobId=...  variations and dayworks raised on this job, and whether this
//                  company can raise them at all (Suite). The job screen hides
//                  the row when `available` is false rather than showing a
//                  button that refuses.
// POST             raise one (multipart: kind, description, hours, materials,
//                  cost, up to six photos).
//
// Raised from site, by the person who did the work, while they are standing in
// front of it. That is the whole point: a variation written up in the office on
// Friday from memory is the one the main contractor disputes. So the required
// fields are the one thing a worker always knows -- what changed -- and the
// rest is optional. The admin prices it later; the worker's figure is kept as
// their estimate, and both are shown side by side.

import { NextResponse } from "next/server"
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"
import { createServiceClient } from "@/lib/supabase/server"
import { verifyActiveFieldToken } from "@/lib/auth"
import { recordFileHash, sha256Hex } from "@/lib/evidence"
import { can, toPlan } from "@/lib/plan"
import {
  MAX_VARIATION_PHOTOS,
  parseHours,
  parsePounds,
  penceToPounds,
  statusLabel,
  toKind,
  toPence,
  variationReference,
} from "@/lib/variations"

export const runtime = "nodejs"

const MAX_PHOTO_BYTES = 10 * 1024 * 1024
const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"])
const R2_BUCKET = process.env.CLOUDFLARE_R2_BUCKET || "vantro-photos"

async function companyCanRaise(service: any, companyId: string): Promise<boolean> {
  const { data } = await service.from("companies").select("plan").eq("id", companyId).maybeSingle()
  return can(toPlan(data?.plan), "variations")
}

export async function GET(request: Request) {
  const installer = await verifyActiveFieldToken(request)
  if (!installer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const service = await createServiceClient()
  if (!(await companyCanRaise(service, installer.companyId))) {
    return NextResponse.json({ available: false, variations: [] })
  }

  const jobId = new URL(request.url).searchParams.get("jobId")
  let q = service
    .from("variations")
    .select("id, job_id, kind, number, description, labour_hours, materials, estimated_value, " +
            "status, photo_urls, created_at, raiser:users!variations_raised_by_fkey(name)")
    .eq("company_id", installer.companyId)
    .order("created_at", { ascending: false })
    .limit(50)
  if (jobId) q = q.eq("job_id", jobId)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // The worker sees their own figure and the status, never the admin's price:
  // what the company charges a main contractor is commercial, and a crew
  // comparing it with their day rate is a conversation nobody asked for.
  return NextResponse.json({
    available: true,
    variations: (data || []).map((v: any) => ({
      id: v.id,
      jobId: v.job_id,
      kind: v.kind,
      reference: variationReference(v.kind, v.number),
      description: v.description,
      labourHours: v.labour_hours === null ? null : Number(v.labour_hours),
      materials: v.materials,
      estimate: v.estimated_value === null ? null : Number(v.estimated_value),
      status: v.status,
      statusLabel: statusLabel(v.status),
      photoUrls: v.photo_urls || [],
      raisedBy: v.raiser?.name || "Unknown",
      raisedAt: v.created_at,
    })),
  })
}

export async function POST(request: Request) {
  const installer = await verifyActiveFieldToken(request)
  if (!installer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const service = await createServiceClient()
  if (!(await companyCanRaise(service, installer.companyId))) {
    return NextResponse.json(
      { error: "Variations are on the Suite plan. Ask your office to upgrade.", requiredPlan: "suite" },
      { status: 402 },
    )
  }

  const form = await request.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: "Expected a multipart upload" }, { status: 400 })

  const jobId = String(form.get("jobId") || "").trim()
  const kind = toKind(String(form.get("kind") || "variation"))
  const description = String(form.get("description") || "").trim()
  const materialsRaw = String(form.get("materials") || "").trim()
  const hours = parseHours(form.get("hours"))
  const costPence = parsePounds(form.get("cost"))

  if (!jobId) return NextResponse.json({ error: "jobId is required" }, { status: 400 })
  if (!description) return NextResponse.json({ error: "Say what changed" }, { status: 400 })
  if (description.length > 8000) {
    return NextResponse.json({ error: "That description is too long (8000 characters max)" }, { status: 400 })
  }
  if (materialsRaw.length > 4000) {
    return NextResponse.json({ error: "Materials is too long (4000 characters max)" }, { status: 400 })
  }
  if (hours === undefined) {
    return NextResponse.json({ error: "Hours must be a number, like 3 or 2.5" }, { status: 400 })
  }
  if (costPence === undefined) {
    return NextResponse.json({ error: "Cost must be an amount in pounds, like 180 or 180.50" }, { status: 400 })
  }

  const { data: job } = await service
    .from("jobs").select("id, company_id, name").eq("id", jobId).maybeSingle()
  if (!job || job.company_id !== installer.companyId) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 })
  }

  const photos = form.getAll("photos").filter(p => p instanceof File) as File[]
  if (photos.length > MAX_VARIATION_PHOTOS) {
    return NextResponse.json({ error: `Up to ${MAX_VARIATION_PHOTOS} photos` }, { status: 400 })
  }

  // Validate every photo before storing any, so a bad fourth photo does not
  // leave three orphans in the bucket.
  const prepared: Array<{ bytes: Buffer; mime: string }> = []
  for (const photo of photos) {
    const mime = (photo.type || "").split(";")[0].trim().toLowerCase()
    if (!ACCEPTED.has(mime)) {
      return NextResponse.json(
        { error: `Photos must be JPEG, PNG, WebP or HEIC. Got ${mime ? `"${mime}"` : "a file with no type"}.` },
        { status: 400 },
      )
    }
    if (photo.size > MAX_PHOTO_BYTES) {
      return NextResponse.json({ error: "Each photo must be under 10MB" }, { status: 400 })
    }
    prepared.push({ bytes: Buffer.from(await photo.arrayBuffer()), mime })
  }

  const photoUrls: string[] = []
  const photoPaths: string[] = []

  if (prepared.length > 0) {
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

    for (const { bytes, mime } of prepared) {
      const sha = sha256Hex(bytes)
      const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : mime.includes("hei") ? "heic" : "jpg"
      // Keyed by content hash: the same photo attached twice is one object.
      const key = `variations/${installer.companyId}/${jobId}/${sha.slice(0, 16)}.${ext}`
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

  const { data: variation, error } = await service
    .from("variations")
    .insert({
      company_id: installer.companyId,
      job_id: jobId,
      raised_by: installer.userId,
      kind,
      description,
      labour_hours: hours,
      materials: materialsRaw || null,
      estimated_value: costPence === null ? null : penceToPounds(costPence),
      photo_urls: photoUrls,
      photo_paths: photoPaths,
      status: "pending",
      ai_detected: false,
    })
    .select("id, kind, number, created_at, estimated_value")
    .single()

  if (error || !variation) {
    console.error("[variations] insert failed", error)
    return NextResponse.json({ error: error?.message || "Could not save" }, { status: 500 })
  }

  const reference = variationReference(variation.kind, variation.number)

  // Into the admin's alerts now, as an issue. A variation waiting for someone
  // to open a tab is a variation that gets priced a month late, after the
  // main contractor has stopped remembering the conversation.
  const estimate = toPence(variation.estimated_value)
  const { error: alertErr } = await service.from("alerts").insert({
    company_id: installer.companyId,
    job_id: jobId,
    user_id: installer.userId,
    alert_type: "issue",
    message:
      `${kind === "daywork" ? "Daywork" : "Variation"} ${reference} raised at ${job.name}` +
      (estimate !== null ? ` (est. £${(estimate / 100).toFixed(2)})` : "") +
      `: ${description.slice(0, 140)}`,
    status: "open",
    urgency: 2,
    is_read: false,
  })
  if (alertErr) console.error("[variations] alert insert failed", alertErr)

  console.log("[variations]", reference, "raised on", jobId, "by", installer.userId)
  return NextResponse.json({
    success: true,
    id: variation.id,
    reference,
    raisedAt: variation.created_at,
  })
}
