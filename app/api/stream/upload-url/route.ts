import { NextResponse } from "next/server"
import { verifyInstallerToken } from "@/lib/auth"

const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID
const CF_STREAM_TOKEN = process.env.CLOUDFLARE_STREAM_TOKEN
const CF_STREAM_SUBDOMAIN = "customer-6416opuz33lyk78q.cloudflarestream.com"

export async function POST(request: Request) {
  const installer = verifyInstallerToken(request)
  if (!installer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    // Request a one-time upload URL from Cloudflare Stream
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream/direct_upload`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${CF_STREAM_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          maxDurationSeconds: 300,
          expiry: new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10 min
        })
      }
    )

    const data = await res.json()
    if (!data.success) {
      console.error("Cloudflare direct_upload failed:", JSON.stringify(data))
      return NextResponse.json({ error: "Upload URL creation failed", cfError: data.errors }, { status: 500 })
    }

    const uid = data.result.uid
    const uploadURL = data.result.uploadURL

    return NextResponse.json({
      uploadURL,
      uid,
      playbackUrl: `https://${CF_STREAM_SUBDOMAIN}/${uid}/manifest/video.m3u8`,
      embedUrl: `https://${CF_STREAM_SUBDOMAIN}/${uid}/iframe`,
      thumbnailUrl: `https://${CF_STREAM_SUBDOMAIN}/${uid}/thumbnails/thumbnail.jpg`
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
