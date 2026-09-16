import { NextResponse } from "next/server"
import { verifyActiveFieldToken } from "@/lib/auth"
import { getClientIp, rateLimit, rateLimitedResponse } from "@/lib/rate-limit"
import { bearerToken, tokenBucketId } from "@/lib/installer-rate-limit"

const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID
const CF_STREAM_TOKEN = process.env.CLOUDFLARE_STREAM_TOKEN

/** Video upload. Tighter than the general field limit, because each one is a file. */
const STREAM_LIMIT = { max: 20, windowSeconds: 3600 }

export async function POST(request: Request) {
  const auth = request.headers.get("authorization")
  if (!auth?.startsWith("Bearer ")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Limited here rather than in middleware because this route is /api/stream,
  // not /api/installer, so the field-app choke point does not see it -- and it
  // is the most expensive thing a field token can do: every call uploads a
  // video to Cloudflare and is billed.
  //
  // Keyed on the token before it is verified, so that a flood of forged tokens
  // cannot consume a real worker's allowance. Twenty an hour is more
  // walkthrough video than anybody records in a day.
  const token = bearerToken(request.headers)
  if (token) {
    const limit = await rateLimit(`stream:token:${await tokenBucketId(token)}`, STREAM_LIMIT.max, STREAM_LIMIT.windowSeconds)
    if (!limit.allowed) return rateLimitedResponse(limit, STREAM_LIMIT.max, "Too many uploads. Try again later.")
  } else {
    const limit = await rateLimit(`stream:ip:${getClientIp(request)}`, STREAM_LIMIT.max, STREAM_LIMIT.windowSeconds)
    if (!limit.allowed) return rateLimitedResponse(limit, STREAM_LIMIT.max, "Too many uploads. Try again later.")
  }

  const installer = await verifyActiveFieldToken(request)
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
    if (!data.success) {
      console.error("Cloudflare Stream upload failed:", JSON.stringify(data))
      return NextResponse.json({ error: "Upload failed", cfError: data.errors || data.messages || "unknown", cfRaw: data }, { status: 500 })
    }

    const video = data.result
    return NextResponse.json({
      uid: video.uid,
      playbackUrl: `https://customer-6416opuz33lyk78q.cloudflarestream.com/${video.uid}/manifest/video.m3u8`,
      embedUrl: `https://customer-6416opuz33lyk78q.cloudflarestream.com/${video.uid}/iframe`,
      thumbnailUrl: `https://customer-6416opuz33lyk78q.cloudflarestream.com/${video.uid}/thumbnails/thumbnail.jpg`,
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