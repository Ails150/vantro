import { NextResponse } from "next/server"
import { verifyInstallerToken } from "@/lib/auth"

const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID
const CF_STREAM_TOKEN = process.env.CLOUDFLARE_STREAM_TOKEN

export async function POST(request: Request) {
  const auth = request.headers.get("authorization")
  if (!auth?.startsWith("Bearer ")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const installer = verifyInstallerToken(request)
  if (!installer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const formData = await request.formData()
    const file = formData.get("file") as File
    if (!file) return NextResponse.json({ error: "No file" }, { status: 400 })

    const uploadForm = new FormData()
    uploadForm.append("file", file)

    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream`,
      {
        method: "POST",
        headers: { "Authorization": `Bearer ${CF_STREAM_TOKEN}` },
        body: uploadForm
      }
    )

    const data = await res.json()
    if (!data.success) return NextResponse.json({ error: "Upload failed" }, { status: 500 })

    const video = data.result
    return NextResponse.json({
      uid: video.uid,
      playbackUrl: `https://customer-${CF_ACCOUNT_ID}.cloudflarestream.com/${video.uid}/manifest/video.m3u8`,
      embedUrl: `https://customer-${CF_ACCOUNT_ID}.cloudflarestream.com/${video.uid}/iframe`,
      thumbnailUrl: `https://customer-${CF_ACCOUNT_ID}.cloudflarestream.com/${video.uid}/thumbnails/thumbnail.jpg`,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const uid = searchParams.get("uid")
  if (!uid) return NextResponse.json({ error: "No uid" }, { status: 400 })

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream/${uid}`,
    { headers: { "Authorization": `Bearer ${CF_STREAM_TOKEN}` } }
  )
  const data = await res.json()
  return NextResponse.json(data.result || {})
}