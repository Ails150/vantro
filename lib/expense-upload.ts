import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import crypto from "crypto"

/**
 * R2 client for the existing vantro-photos bucket.
 * Receipts are stored under the receipts/ prefix to keep them
 * separate from diary photos (which use the root + diary/ prefix).
 */

const R2_ENDPOINT = `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.eu.r2.cloudflarestorage.com`
const R2_BUCKET = process.env.CLOUDFLARE_R2_BUCKET || "vantro-photos"

function getR2Client(): S3Client {
  if (!process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || !process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY) {
    throw new Error("R2 credentials not set")
  }
  if (!process.env.CLOUDFLARE_ACCOUNT_ID) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID not set")
  }
  return new S3Client({
    region: "auto",
    endpoint: R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
    },
  })
}

const ALLOWED_MIMES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/heic",
  "image/heif",
  "application/pdf",
])

const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10MB

export interface UploadReceiptArgs {
  companyId: string
  userId: string
  fileBuffer: Buffer
  mimeType: string
  fileName?: string
}

export interface UploadReceiptResult {
  key: string
  publicUrl: string
}

/**
 * Upload a receipt file to R2 and return the object key + public URL.
 * Key format: receipts/<companyId>/<userId>/<yyyymmdd>/<random>.<ext>
 *
 * Throws on:
 *  - Unsupported mime type
 *  - File > 10MB
 *  - R2 client misconfigured
 *  - R2 upload failure
 */
export async function uploadReceipt(args: UploadReceiptArgs): Promise<UploadReceiptResult> {
  const { companyId, userId, fileBuffer, mimeType, fileName } = args

  if (!ALLOWED_MIMES.has(mimeType)) {
    throw new Error(`Unsupported file type: ${mimeType}. Allowed: JPEG, PNG, HEIC, PDF.`)
  }
  if (fileBuffer.byteLength > MAX_FILE_BYTES) {
    throw new Error(`File too large: ${(fileBuffer.byteLength / 1024 / 1024).toFixed(1)}MB. Max 10MB.`)
  }

  const ext = mimeType === "application/pdf"
    ? "pdf"
    : mimeType === "image/png"
      ? "png"
      : mimeType.includes("heic") || mimeType.includes("heif")
        ? "heic"
        : "jpg"

  const yyyymmdd = new Date().toISOString().slice(0, 10).replace(/-/g, "")
  const random = crypto.randomBytes(8).toString("hex")
  const key = `receipts/${companyId}/${userId}/${yyyymmdd}/${random}.${ext}`

  const client = getR2Client()
  await client.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: fileBuffer,
    ContentType: mimeType,
    Metadata: {
      "uploaded-by": userId,
      "company-id": companyId,
      "original-name": fileName || "receipt",
    },
  }))

  const publicBase = process.env.CLOUDFLARE_R2_PUBLIC_URL || ""
  const publicUrl = publicBase
    ? `${publicBase.replace(/\/$/, "")}/${key}`
    : key  // fallback: just return the key, signed URLs will be generated for access

  return { key, publicUrl }
}

/**
 * Generate a signed URL for viewing a receipt (1 hour expiry by default).
 * Use this in admin and installer GET endpoints so receipts aren't
 * permanently public-accessible by URL.
 */
export async function getReceiptSignedUrl(key: string, expirySeconds = 3600): Promise<string> {
  const client = getR2Client()
  const cmd = new GetObjectCommand({ Bucket: R2_BUCKET, Key: key })
  return await getSignedUrl(client, cmd, { expiresIn: expirySeconds })
}

/**
 * Extract the R2 key from a stored receipt URL.
 * The DB stores either the public URL (https://pub-xxx.r2.dev/receipts/...)
 * or just the key (receipts/...).
 */
export function extractKeyFromReceiptUrl(urlOrKey: string): string {
  if (urlOrKey.startsWith("receipts/")) return urlOrKey
  const idx = urlOrKey.indexOf("/receipts/")
  if (idx >= 0) return urlOrKey.slice(idx + 1)
  return urlOrKey
}

