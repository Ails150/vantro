// lib/uploads/mime.ts
//
// What MIME type is this uploaded file, and is it one we accept?
//
// This exists because `file.type || "image/jpeg"` recorded every receipt whose
// client sent no MIME type as a JPEG -- including PDFs -- and expenses.receipt_mime
// was write-once, so the guess could never be corrected. A guess that cannot be
// undone is worse than a refusal, so this refuses.

export const ACCEPTED_RECEIPT_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
] as const

export type ReceiptMimeResult =
  | { ok: true; mime: string }
  | { ok: false; error: string }

/**
 * Normalise and validate the MIME type of a receipt upload.
 *
 * Never falls back to a default. An absent or unrecognised type is an error the
 * caller must surface, not something to paper over: the value is stored as
 * evidence about what the file is.
 *
 * Parameters after the type are stripped ("image/jpeg; charset=binary" is still
 * image/jpeg) and the result is lowercased, so the same file does not produce
 * two different stored values depending on which client sent it.
 */
export function normaliseReceiptMime(raw: string | null | undefined): ReceiptMimeResult {
  const trimmed = (raw ?? "").split(";")[0].trim().toLowerCase()

  if (!trimmed) {
    return {
      ok: false,
      error:
        "Receipt file type is missing. Your app or browser did not say what kind of file this is; " +
        "re-take the photo or pick the file again.",
    }
  }
  // Some clients send this for "I have no idea", which is not a type.
  if (trimmed === "application/octet-stream") {
    return {
      ok: false,
      error:
        "Receipt file type could not be identified. Re-take the photo, or upload it as a JPEG, PNG or PDF.",
    }
  }
  if (!(ACCEPTED_RECEIPT_MIMES as readonly string[]).includes(trimmed)) {
    return {
      ok: false,
      error: `Receipt must be a JPEG, PNG, WebP, HEIC or PDF. Got "${trimmed}".`,
    }
  }
  return { ok: true, mime: trimmed }
}

/**
 * Parse a client-supplied recording timestamp.
 *
 * walkthroughs.recorded_at is when the clip was RECORDED, which for a queued
 * offline upload is not when it arrived. It is write-once evidence, so a wrong
 * value at insert is permanent -- hence no default, here or in the database.
 *
 * `now` is passed in so the future-clamp is testable.
 */
export function parseRecordedAt(
  raw: unknown,
  now: Date,
): { ok: true; at: Date } | { ok: false; error: string } {
  if (typeof raw !== "string" || !raw.trim()) {
    return {
      ok: false,
      error:
        "recordedAt is required. Update the Vantro app: older versions did not send " +
        "the recording time and the server will no longer guess it from the upload time.",
    }
  }
  const at = new Date(raw)
  if (isNaN(at.getTime())) {
    return { ok: false, error: "recordedAt is not a valid ISO timestamp." }
  }
  // A clip cannot have been recorded in the future. Small clock skew is
  // tolerated by clamping; anything beyond an hour is a broken client, and
  // silently accepting it would put evidence in the wrong day.
  const skewMs = at.getTime() - now.getTime()
  if (skewMs > 60 * 60 * 1000) {
    return { ok: false, error: "recordedAt is more than an hour in the future; check the device clock." }
  }
  if (skewMs > 0) return { ok: true, at: now }

  // Nothing in this product records a walkthrough a year before uploading it.
  if (now.getTime() - at.getTime() > 365 * 24 * 3600 * 1000) {
    return { ok: false, error: "recordedAt is more than a year old; check the device clock." }
  }
  return { ok: true, at }
}
