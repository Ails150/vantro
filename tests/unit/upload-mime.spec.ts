import { test, expect } from "@playwright/test"
import { normaliseReceiptMime, parseRecordedAt } from "../../lib/uploads/mime"

/**
 * Two values that used to be guessed, on columns the append-only trigger makes
 * write-once. A guess on a write-once column is permanent, which is why both
 * now refuse rather than default.
 */

test.describe("receipt MIME: refuse, do not guess", () => {
  test("accepts the types a receipt actually arrives as", () => {
    for (const t of ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"]) {
      const r = normaliseReceiptMime(t)
      expect(r.ok, t).toBe(true)
      if (r.ok) expect(r.mime).toBe(t)
    }
  })

  test("a missing type is an error, not an image/jpeg", () => {
    for (const missing of [undefined, null, "", "   "]) {
      const r = normaliseReceiptMime(missing)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toMatch(/missing/i)
    }
  })

  test("application/octet-stream is 'no idea', not a type", () => {
    const r = normaliseReceiptMime("application/octet-stream")
    expect(r.ok).toBe(false)
  })

  test("an unsupported type is named in the error", () => {
    const r = normaliseReceiptMime("video/quicktime")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain("video/quicktime")
  })

  test("parameters are stripped and case is normalised", () => {
    const a = normaliseReceiptMime("IMAGE/JPEG")
    const b = normaliseReceiptMime("image/jpeg; charset=binary")
    expect(a.ok && a.mime).toBe("image/jpeg")
    expect(b.ok && b.mime).toBe("image/jpeg")
  })

  test("the same file never stores two different values", () => {
    const variants = ["image/png", "IMAGE/PNG", " image/png ", "image/png;q=1"]
    const stored = new Set(variants.map(v => { const r = normaliseReceiptMime(v); return r.ok ? r.mime : "ERR" }))
    expect([...stored]).toEqual(["image/png"])
  })
})

test.describe("walkthrough recordedAt: the recording time, not the upload time", () => {
  const now = new Date("2026-09-12T18:00:00Z")

  test("an offline clip keeps the hour it was recorded", () => {
    // Recorded on site at 09:15, uploaded that evening.
    const r = parseRecordedAt("2026-09-12T09:15:00Z", now)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.at.toISOString()).toBe("2026-09-12T09:15:00.000Z")
  })

  test("an app that does not send it is refused, not defaulted to now", () => {
    for (const missing of [undefined, null, "", "  ", 12345, {}]) {
      const r = parseRecordedAt(missing, now)
      expect(r.ok, String(missing)).toBe(false)
    }
    const r = parseRecordedAt(undefined, now)
    if (!r.ok) expect(r.error).toMatch(/required/i)
  })

  test("garbage is refused", () => {
    expect(parseRecordedAt("last tuesday", now).ok).toBe(false)
  })

  test("small clock skew into the future clamps to now", () => {
    const r = parseRecordedAt("2026-09-12T18:20:00Z", now)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.at.getTime()).toBe(now.getTime())
  })

  test("a wildly wrong clock is refused in both directions", () => {
    expect(parseRecordedAt("2027-01-01T00:00:00Z", now).ok).toBe(false)
    expect(parseRecordedAt("2020-01-01T00:00:00Z", now).ok).toBe(false)
  })
})
