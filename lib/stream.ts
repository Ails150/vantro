export const CLOUDFLARE_STREAM_BASE = `https://customer-${process.env.CLOUDFLARE_ACCOUNT_ID}.cloudflarestream.com`

export function getStreamEmbedUrl(uid: string) {
  return `${CLOUDFLARE_STREAM_BASE}/${uid}/iframe`
}

export function getStreamThumbnailUrl(uid: string) {
  return `${CLOUDFLARE_STREAM_BASE}/${uid}/thumbnails/thumbnail.jpg`
}

export async function uploadToStream(file: File, authToken: string): Promise<{ uid: string; embedUrl: string; thumbnailUrl: string } | null> {
  const formData = new FormData()
  formData.append("file", file)
  const res = await fetch("/api/stream", {
    method: "POST",
    headers: { "Authorization": `Bearer ${authToken}` },
    body: formData
  })
  if (!res.ok) return null
  return res.json()
}