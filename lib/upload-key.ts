// lib/upload-key.ts
//
// Where an uploaded file is allowed to land, and what it is allowed to be.
//
// THE BUG THIS EXISTS FOR. /api/upload took the object key from the request:
//
//     const path = formData.get("path") as string || `uploads/${Date.now()}...`
//     await R2.send(new PutObjectCommand({ Key: path, ... }))
//
// A field token is all it takes to call that route, so anybody holding one
// could write to ANY key in the bucket. Three consequences, in increasing order
// of seriousness:
//
//   1. Overwrite another company's photograph, if its key can be guessed. Keys
//      are `qa/<jobId>/<itemId>/photo_<timestamp>.jpg`, so a job id is enough.
//   2. Overwrite your own already-hashed evidence. The hash ledger is
//      append-only so this is detectable rather than silent -- which is the
//      design working -- but the file itself is gone.
//   3. OVERWRITE AN ISSUED AUDIT PACK'S ARCHIVE. CLOUDFLARE_R2_ARCHIVE_BUCKET
//      is not set in production, so lib/audit/archive.ts falls back to the same
//      bucket this route writes to, under `audit-archive/<companyId>/...`. The
//      archive is the thing that makes a pack verifiable years after it was
//      issued, and it was writable by any installer.
//
// So the key is DERIVED HERE and the client's suggestion is used only for its
// file extension. The app already stores whatever `path` the route returns, so
// nothing downstream has to change.
//
// The company prefix is a second benefit: lib/r2-purge.ts notes that "only some
// uploads are written under a company-scoped prefix, so a prefix sweep would
// both miss files", which is why erasure has to reconstruct keys from the
// database. Everything written from now on is sweepable.

import crypto from "crypto"

/** Prefixes nothing uploaded by a client may ever be written under. */
export const RESERVED_PREFIXES = ["audit-archive/", "audit-packs/", "exports/", "backups/"]

/**
 * What the field app is allowed to send.
 *
 * An allowlist, not a denylist. The type was previously taken from the client
 * and written to R2 as the object's Content-Type, so `text/html` on a bucket
 * with a public URL was a stored page served from our own domain.
 */
export const ALLOWED_UPLOAD_TYPES = new Set([
  "image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif",
  "video/mp4", "video/quicktime",
  "audio/mp4", "audio/m4a", "audio/mpeg", "audio/aac",
  "application/pdf",
])

/** 100 MB. A walkthrough clip is the biggest thing the app sends. */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024

const EXTENSION_FOR: Record<string, string> = {
  "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp",
  "image/heic": "heic", "image/heif": "heif",
  "video/mp4": "mp4", "video/quicktime": "mov",
  "audio/mp4": "m4a", "audio/m4a": "m4a", "audio/mpeg": "mp3", "audio/aac": "aac",
  "application/pdf": "pdf",
}

/**
 * The extension to store under.
 *
 * Taken from the declared content type rather than from the client's filename,
 * so the extension and the type cannot disagree -- a `.jpg` that is served as
 * `text/html` is the oldest trick there is.
 */
export function extensionForType(contentType: string): string {
  return EXTENSION_FOR[contentType.toLowerCase()] || "bin"
}

/**
 * A folder hint, kept only so a human reading the bucket can tell what a file
 * is. Reduced to a single safe word; it can never introduce a slash, a dot or a
 * prefix of its own.
 */
export function safeCategory(suggested: string | null | undefined): string {
  const first = String(suggested ?? "").split("/")[0].toLowerCase()
  return /^[a-z][a-z0-9-]{0,23}$/.test(first) ? first : "upload"
}

/**
 * The key an upload is written to.
 *
 * Nothing in it comes from the request except the category word and the
 * extension, both of which are constrained to a character class that cannot
 * express a path. The random component means one upload can never overwrite
 * another, by accident or otherwise.
 */
export function uploadKey(
  companyId: string,
  contentType: string,
  suggestedPath?: string | null,
): string {
  const now = new Date()
  const yyyymm = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`
  return [
    "u",
    companyId,
    yyyymm,
    safeCategory(suggestedPath),
    `${crypto.randomUUID()}.${extensionForType(contentType)}`,
  ].join("/")
}

export type UploadCheck =
  | { ok: true; contentType: string }
  | { ok: false; status: number; error: string }

/** Is this file allowed at all? */
export function checkUpload(contentType: string | null | undefined, bytes: number): UploadCheck {
  const type = String(contentType || "").split(";")[0].trim().toLowerCase()
  if (!type) return { ok: false, status: 400, error: "A file type is required." }
  if (!ALLOWED_UPLOAD_TYPES.has(type)) {
    return { ok: false, status: 415, error: `Files of type ${type} are not accepted.` }
  }
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return { ok: false, status: 400, error: "The file is empty." }
  }
  if (bytes > MAX_UPLOAD_BYTES) {
    return { ok: false, status: 413, error: "That file is too large." }
  }
  return { ok: true, contentType: type }
}
