import { NextResponse } from "next/server"
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"
import { verifyActiveFieldToken } from "@/lib/auth"
import { checkRateLimit } from "@/lib/rate-limit"
import { recordFileHash, sha256Hex } from "@/lib/evidence"
import { checkUpload, uploadKey } from "@/lib/upload-key"

export const runtime = "nodejs"
export const maxDuration = 60
export const dynamic = "force-dynamic"

const R2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.eu.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY!,
  },
})

export async function POST(request: Request) {
  // audit-guard-2026-05-19 - security hardening pass
  {
    const _ip = (request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim()
    const _ok = await checkRateLimit(`upload:ip:${_ip}`, 50, 3600)
    if (!_ok) {
      return NextResponse.json({ error: "Too many requests. Slow down." }, { status: 429 })
    }
  }

  const auth = request.headers.get("authorization")
  if (!auth?.startsWith("Bearer ")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const installer = await verifyActiveFieldToken(request)
  if (!installer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const formData = await request.formData()
    const file = formData.get("file") as File
    const suggested = formData.get("path") as string | null

    if (!file) return NextResponse.json({ error: "No file" }, { status: 400 })

    // THE KEY IS DERIVED, NOT SUPPLIED.
    //
    // It used to be `formData.get("path")`, written straight through as the R2
    // object key. A field token was enough to write to any key in the bucket --
    // including audit-archive/, because CLOUDFLARE_R2_ARCHIVE_BUCKET is unset in
    // production and the archive falls back to this same bucket. The thing that
    // makes an issued pack verifiable years later was writable by any installer.
    //
    // The client's suggestion survives only as a category word. The app already
    // stores whatever `path` this route returns, so nothing downstream changes.
    const check = checkUpload(file.type, file.size)
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status })

    const path = uploadKey(installer.companyId, check.contentType, suggested)

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    await R2.send(new PutObjectCommand({
      Bucket: process.env.CLOUDFLARE_R2_BUCKET!,
      Key: path,
      Body: buffer,
      // The checked type, not file.type. Writing a client-declared Content-Type
      // to a bucket with a public URL is how you end up hosting somebody's HTML.
      ContentType: check.contentType,
      // Belt and braces for the same reason: even if a type slipped through,
      // the browser is told to download rather than render it.
      ContentDisposition: "attachment",
    }))

    // Phase 1.1: hash the bytes, not the URL. This is the only point in the
    // system where the file exists as bytes -- everything downstream sees a
    // string. Recorded after the put, so a hash never claims a file that was
    // never stored. Every QA photo, diary photo and defect photo/video in the
    // product comes through here.
    const sha256 = sha256Hex(buffer)
    await recordFileHash({
      companyId: installer.companyId,
      storagePath: path,
      sha256,
      hashedBy: installer.userId,
    })

    const url = `${process.env.CLOUDFLARE_R2_PUBLIC_URL}/${path}`
    return NextResponse.json({ url, path, sha256 })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}