// lib/r2-purge.ts
//
// Deleting a company's files out of object storage.
//
// WHY THIS EXISTS: THE COMPANY DELETE DID NOT DO IT.
// app/api/account/delete/route.ts has carried the comment "GDPR Article 17
// compliant" since it was written, and deleted rows from twelve tables and
// nothing from R2. Every photograph, receipt, video, RAMS PDF and walkthrough
// recording a company ever uploaded stayed in the bucket after they deleted
// their account and were told their data was gone. That is the single worst
// kind of privacy bug: not a gap somebody might find, but a claim that was not
// true.
//
// HOW OBJECTS ARE FOUND
// Files are not indexed by company in one place -- they are referenced from a
// dozen columns across a dozen tables as URLs or as R2 keys. Listing the bucket
// by prefix would be simpler, but only some uploads are written under a
// company-scoped prefix, so a prefix sweep would both miss files and risk
// deleting another tenant's. So the keys are COLLECTED FROM THE ROWS before the
// rows are deleted, which also means this has to run first.
//
// IT IS BEST EFFORT, AND SAYS WHICH KEYS IT COULD NOT REMOVE.
// A storage failure must not abort a deletion the user has asked for and
// confirmed -- leaving them with a half-deleted account and no way to retry is
// worse than leaving files behind. So failures are collected and returned, and
// the caller reports them rather than throwing them away.

import { S3Client, DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3"

const BUCKET = process.env.CLOUDFLARE_R2_BUCKET || ""
const ARCHIVE_BUCKET = process.env.CLOUDFLARE_R2_ARCHIVE_BUCKET || BUCKET

function client(): S3Client | null {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID
  const keyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID
  const secret = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY
  if (!account || !keyId || !secret || !BUCKET) return null
  return new S3Client({
    region: "auto",
    endpoint: `https://${account}.eu.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: keyId, secretAccessKey: secret },
  })
}

/**
 * Turn a stored value into an object key.
 *
 * Media is stored inconsistently in this schema -- diary photos as full public
 * URLs, QA and defect media as a key alongside the URL, archive copies as keys.
 * Rather than fix that here, this accepts either shape.
 *
 * Returns null for anything that is not ours. A URL pointing somewhere else
 * entirely must not be turned into a key and handed to a delete call.
 */
export function keyFromStoredValue(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null

  if (!/^https?:\/\//i.test(trimmed)) {
    // Already a key. Leading slashes would produce an empty first path segment.
    return trimmed.replace(/^\/+/, "") || null
  }

  const base = process.env.CLOUDFLARE_R2_PUBLIC_URL
  if (base && trimmed.startsWith(base)) {
    const key = trimmed.slice(base.replace(/\/$/, "").length + 1)
    return key ? key.split("?")[0] : null
  }

  // An absolute URL that is not on our public base. Could be a Cloudflare
  // Stream link or an external image; not ours to delete.
  return null
}

export type PurgeResult = {
  /** Objects successfully deleted. */
  deleted: number
  /** Keys the storage provider refused, with the reason. */
  failed: Array<{ key: string; reason: string }>
  /** True when storage is not configured at all, so nothing was attempted. */
  skipped: boolean
}

/**
 * Delete a set of keys from both buckets.
 *
 * Both, because an audit pack archive copy lives in the archive bucket, which
 * may be a different one. Deleting from the main bucket alone would leave the
 * archived copies of every photograph behind -- and those are the durable ones.
 *
 * Deletes in batches of 1000, which is the S3 DeleteObjects limit.
 */
export async function purgeKeys(keys: string[]): Promise<PurgeResult> {
  const unique = Array.from(new Set(keys.filter(Boolean)))
  if (unique.length === 0) return { deleted: 0, failed: [], skipped: false }

  const s3 = client()
  if (!s3) {
    console.error("[r2-purge] storage is not configured; no objects were deleted")
    return { deleted: 0, failed: [], skipped: true }
  }

  const buckets = Array.from(new Set([BUCKET, ARCHIVE_BUCKET].filter(Boolean)))
  let deleted = 0
  const failed: Array<{ key: string; reason: string }> = []

  for (const bucket of buckets) {
    for (let i = 0; i < unique.length; i += 1000) {
      const batch = unique.slice(i, i + 1000)
      try {
        const res = await s3.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            // Quiet: we only want what went wrong. A successful delete of a key
            // that was never there is not an error in S3, which is the correct
            // behaviour for a purge that may run twice.
            Delete: { Objects: batch.map(Key => ({ Key })), Quiet: true },
          }),
        )
        deleted += batch.length - (res.Errors?.length ?? 0)
        for (const e of res.Errors ?? []) {
          failed.push({ key: e.Key || "unknown", reason: `${bucket}: ${e.Code || e.Message || "unknown"}` })
        }
      } catch (err: any) {
        // A whole batch failing is one failure, not a thousand, but every key
        // in it is still unaccounted for and has to be reported as such.
        for (const key of batch) {
          failed.push({ key, reason: `${bucket}: ${err?.message || "request failed"}` })
        }
      }
    }
  }

  if (failed.length > 0) {
    console.error(`[r2-purge] ${failed.length} object(s) could not be deleted`, failed.slice(0, 10))
  }
  console.log(`[r2-purge] deleted ${deleted} object(s) across ${buckets.length} bucket(s)`)

  return { deleted, failed, skipped: false }
}

/**
 * Every column in this schema that can hold a file reference.
 *
 * Written out rather than discovered, and it is the part of this file most
 * likely to go stale: a new table with a photo column will not appear here by
 * itself. tests/unit/r2-purge.spec.ts pins the list so that adding one is a
 * deliberate act with a failing test attached.
 */
export const MEDIA_COLUMNS: Array<{ table: string; columns: string[] }> = [
  { table: "diary_entries", columns: ["photo_urls", "video_url"] },
  { table: "qa_submissions", columns: ["photo_url", "photo_path", "video_url"] },
  { table: "defects", columns: ["photo_url", "photo_path"] },
  { table: "incidents", columns: ["photo_urls", "photo_paths"] },
  { table: "expenses", columns: ["receipt_url", "receipt_path"] },
  { table: "walkthroughs", columns: ["audio_url", "audio_path"] },
  { table: "walkthrough_clips", columns: ["clip_url", "clip_path"] },
  { table: "rams_documents", columns: ["document_url", "document_path"] },
  { table: "toolbox_talks", columns: ["document_url", "document_path"] },
  { table: "checklist_run_items", columns: ["photo_url", "video_url"] },
]

/**
 * Collect every object key belonging to one company.
 *
 * Must run BEFORE the rows are deleted: the keys only exist on the rows.
 *
 * A missing table or column is skipped rather than fatal. This list is
 * maintained by hand against a schema that changes, and a purge that refuses to
 * run because one column was renamed would leave every other file in place.
 */
export async function collectCompanyKeys(service: any, companyId: string): Promise<string[]> {
  const keys: string[] = []

  for (const { table, columns } of MEDIA_COLUMNS) {
    try {
      const { data, error } = await service
        .from(table)
        .select(columns.join(", "))
        .eq("company_id", companyId)
        .limit(100000)

      if (error) {
        console.error(`[r2-purge] could not read ${table}: ${error.message}`)
        continue
      }

      for (const row of data ?? []) {
        for (const col of columns) {
          const value = (row as any)[col]
          if (Array.isArray(value)) {
            for (const v of value) {
              const k = keyFromStoredValue(v)
              if (k) keys.push(k)
            }
          } else {
            const k = keyFromStoredValue(value)
            if (k) keys.push(k)
          }
        }
      }
    } catch (err: any) {
      console.error(`[r2-purge] ${table} threw: ${err?.message || err}`)
    }
  }

  // Audit pack archive copies. These are not referenced from any row -- the
  // archive derives its keys from a prefix -- so they have to be LISTED.
  //
  // DeleteObjects takes keys and silently ignores a prefix, so pushing
  // "audit-archive/<company>/" here would delete nothing while appearing to
  // succeed. The listing is scoped to the company's own prefix, which is what
  // makes it safe to sweep rather than enumerate.
  const archiveKeys = await listPrefix(`audit-archive/${companyId}/`)
  keys.push(...archiveKeys)

  return Array.from(new Set(keys))
}

/**
 * Every key under a prefix, across both buckets.
 *
 * Paginated: R2 returns at most 1000 keys per call, and a company with six
 * weeks of site photographs in its packs will exceed that.
 */
export async function listPrefix(prefix: string): Promise<string[]> {
  const s3 = client()
  if (!s3) return []

  const buckets = Array.from(new Set([BUCKET, ARCHIVE_BUCKET].filter(Boolean)))
  const found: string[] = []

  for (const bucket of buckets) {
    let token: string | undefined = undefined
    try {
      do {
        const res: any = await s3.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ContinuationToken: token,
          }),
        )
        for (const obj of res.Contents ?? []) {
          if (obj?.Key) found.push(obj.Key)
        }
        token = res.IsTruncated ? res.NextContinuationToken : undefined
      } while (token)
    } catch (err: any) {
      console.error(`[r2-purge] could not list ${bucket}/${prefix}: ${err?.message || err}`)
    }
  }

  return found
}
