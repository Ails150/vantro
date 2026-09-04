// lib/audit/archive.ts
//
// Phase 1.3: permanent evidence.
//
// A pack references photos and videos by signed URL. Those URLs expire, the
// underlying objects can be replaced, and a share link dies after 30 days. An
// assessor opening the pack in eighteen months has a document full of dead
// images — which is to say, no evidence at all.
//
// On pack generation every referenced file is copied, server side, into
//
//     audit-archive/<companyId>/<packRef>/<sha256>.<ext>
//
// Named by the hash of its own bytes, so the filename IS the integrity claim:
// fetch the object, hash it, compare to the name. No index to consult and
// nothing to trust.
//
// R2 CopyObject does this without the bytes passing through this process, so
// archiving a pack costs a handful of API calls rather than a download and
// re-upload of every image.
//
// WHAT IS NOT ENFORCED HERE, AND MUST BE DONE BY A HUMAN
// The spec asks for a bucket with "no delete policy for any app role". That is
// infrastructure, not code: it needs either a separate R2 bucket with its own
// scoped API token that lacks DeleteObject, or an object-lock/immutability
// policy on the archive prefix. This module writes to
// CLOUDFLARE_R2_ARCHIVE_BUCKET when it is set and falls back to the main bucket
// otherwise. Until that token exists, the application credentials CAN delete
// what they just archived, and the archive is durable by convention rather than
// by permission. PHASE-1.md carries this as an outstanding item; do not
// describe the archive as write-once to a customer until it is done.

import { S3Client, CopyObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3"

const MAIN_BUCKET = process.env.CLOUDFLARE_R2_BUCKET || ""
const ARCHIVE_BUCKET = process.env.CLOUDFLARE_R2_ARCHIVE_BUCKET || MAIN_BUCKET

function client(): S3Client | null {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID
  const keyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID
  const secret = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY
  if (!account || !keyId || !secret || !MAIN_BUCKET) return null
  return new S3Client({
    region: "auto",
    endpoint: `https://${account}.eu.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: keyId, secretAccessKey: secret },
  })
}

function extensionOf(key: string): string {
  const m = key.match(/\.([a-z0-9]{2,5})(?:\?|$)/i)
  return m ? m[1].toLowerCase() : "bin"
}

export function archiveKey(companyId: string, packRef: string, sha256: string, sourceKey: string): string {
  return `audit-archive/${companyId}/${packRef}/${sha256}.${extensionOf(sourceKey)}`
}

/** Public URL of an archived object, derived rather than stored. Deriving keeps
 *  it out of the signed manifest, which must not change after signing. */
export function archiveUrl(companyId: string, packRef: string, sha256: string, sourceKey: string): string | null {
  const base = process.env.CLOUDFLARE_R2_PUBLIC_URL
  if (!base) return null
  return `${base.replace(/\/$/, "")}/${archiveKey(companyId, packRef, sha256, sourceKey)}`
}

export type ArchiveSubject = { sourceKey: string; sha256: string }

export type ArchiveResult = {
  attempted: number
  copied: number
  alreadyPresent: number
  failed: number
  /** Source keys that could not be archived, so the pack can say so rather than
   *  linking to an object that is not there. */
  failedKeys: string[]
  bucket: string
  /** True when the archive shares the app's read-write bucket, i.e. the
   *  write-once guarantee is not yet enforced by permissions. */
  sharesAppBucket: boolean
}

/**
 * Copy each file into the pack's archive prefix.
 *
 * Never throws. An archive miss must not stop a pack being produced; it must be
 * visible instead. Callers get failedKeys and are expected to render the
 * shortfall rather than quietly link to objects that do not exist.
 */
export async function archivePackFiles(args: {
  companyId: string
  packRef: string
  subjects: ArchiveSubject[]
}): Promise<ArchiveResult> {
  const result: ArchiveResult = {
    attempted: args.subjects.length,
    copied: 0,
    alreadyPresent: 0,
    failed: 0,
    failedKeys: [],
    bucket: ARCHIVE_BUCKET,
    sharesAppBucket: ARCHIVE_BUCKET === MAIN_BUCKET,
  }

  const s3 = client()
  if (!s3 || args.subjects.length === 0) {
    if (!s3 && args.subjects.length > 0) {
      result.failed = args.subjects.length
      result.failedKeys = args.subjects.map(s => s.sourceKey)
    }
    return result
  }

  // Sequential on purpose. These run inside a request that is already doing a
  // lot, and a burst of parallel copies on a large job is a good way to hit R2
  // rate limits and turn a slow pack into a failed one.
  for (const subject of args.subjects) {
    const destKey = archiveKey(args.companyId, args.packRef, subject.sha256, subject.sourceKey)
    try {
      // Content-addressed: if an object of this name exists it is byte-identical
      // by construction, so re-copying it would be pure waste.
      try {
        await s3.send(new HeadObjectCommand({ Bucket: ARCHIVE_BUCKET, Key: destKey }))
        result.alreadyPresent++
        continue
      } catch {
        // Not there; fall through and copy.
      }

      await s3.send(new CopyObjectCommand({
        Bucket: ARCHIVE_BUCKET,
        Key: destKey,
        CopySource: `${MAIN_BUCKET}/${subject.sourceKey}`,
        MetadataDirective: "COPY",
      }))
      result.copied++
    } catch (e: any) {
      result.failed++
      result.failedKeys.push(subject.sourceKey)
      console.error("[audit] archive copy failed", subject.sourceKey, "->", destKey, e?.message)
    }
  }

  return result
}
