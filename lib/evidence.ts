// lib/evidence.ts
//
// Phase 1.1 (part 3 of 3): file-byte hashes.
//
// Row hashes are written by database triggers, inside the capturing
// transaction, where no application code can skip them
// (supabase/migrations/20260904010000_evidence_hashes.sql). File bytes are the
// one thing a trigger cannot see: by the time a photo_url reaches Postgres it
// is a string, and hashing a URL proves nothing about the image it points at.
//
// So the upload handler does it, at the only moment the bytes exist in the
// process. That is a weaker guarantee than the triggers give -- it is
// application code, and application code can be changed or bypassed -- and the
// pack should not describe the two as equivalent.
//
// A file hash is keyed by storage_path, not by an entity id. The photo is
// uploaded before the row that references it exists, so at hash time there is
// nothing to point at. The link is made from the other side: the QA submission
// or diary entry stores photo_path, and that row's own hash covers it.

import crypto from "crypto"
import { createServiceClient } from "@/lib/supabase/server"

export function sha256Hex(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex")
}

type RecordFileHashArgs = {
  companyId: string | null
  /** R2 object key. The join back to the row that references this file. */
  storagePath: string
  sha256: string
  /** Uploader, for the chain of custody. */
  hashedBy?: string | null
}

/**
 * Append the hash of a stored file to evidence_hashes.
 *
 * Best effort, deliberately. If this write fails the bytes are already in R2
 * and the user's photo works; failing the request would make them re-upload and
 * leave an orphan object behind. Breaking photo capture to record a log entry
 * is the wrong trade in the field, where the alternative is an installer who
 * cannot file their QA item.
 *
 * It is not silent, though -- that is the failure mode this phase exists to
 * remove. A miss is logged with the path, so an unhashed file is findable
 * rather than merely absent. Returns whether the row was written.
 */
export async function recordFileHash(args: RecordFileHashArgs): Promise<boolean> {
  try {
    const service = await createServiceClient()
    const { error } = await service.from("evidence_hashes").insert({
      company_id: args.companyId,
      entity_type: "file",
      entity_id: null,
      storage_path: args.storagePath,
      event: "created",
      sha256: args.sha256,
      algorithm: "sha256",
      payload_version: 1,
      hashed_by: args.hashedBy || null,
    })
    if (error) {
      console.error("[evidence] file hash not recorded", args.storagePath, error.message)
      return false
    }
    return true
  } catch (e: any) {
    console.error("[evidence] file hash not recorded", args.storagePath, e?.message)
    return false
  }
}
