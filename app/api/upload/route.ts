import { NextResponse } from "next/server"
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"
import { verifyFieldToken } from "@/lib/auth"
import { checkRateLimit } from "@/lib/rate-limit"
import { recordFileHash, sha256Hex } from "@/lib/evidence"

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
  const installer = verifyFieldToken(request)
  if (!installer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const formData = await request.formData()
    const file = formData.get("file") as File
    const path = formData.get("path") as string || `uploads/${Date.now()}-${Math.random().toString(36).slice(2)}`

    if (!file) return NextResponse.json({ error: "No file" }, { status: 400 })

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    await R2.send(new PutObjectCommand({
      Bucket: process.env.CLOUDFLARE_R2_BUCKET!,
      Key: path,
      Body: buffer,
      ContentType: file.type || "image/jpeg",
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