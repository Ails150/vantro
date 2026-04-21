import { NextResponse } from "next/server"
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"
import { verifyInstallerToken } from "@/lib/auth"

const R2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.eu.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY!,
  },
})

export async function POST(request: Request) {
  const auth = request.headers.get("authorization")
  if (!auth?.startsWith("Bearer ")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const installer = verifyInstallerToken(request)
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

    const url = `${process.env.CLOUDFLARE_R2_PUBLIC_URL}/${path}`
    return NextResponse.json({ url, path })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}