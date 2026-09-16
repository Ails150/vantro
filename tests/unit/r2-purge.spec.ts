import { test, expect } from "@playwright/test"
import { MEDIA_COLUMNS, keyFromStoredValue } from "../../lib/r2-purge"

/**
 * The company delete told people their data was gone while leaving every file
 * in the bucket. These tests guard the two things that would let that happen
 * again: a key that is not recognised, and a media column nobody added here.
 */

test.describe("keyFromStoredValue", () => {
  const BASE = process.env.CLOUDFLARE_R2_PUBLIC_URL

  test("a bare key is already a key", () => {
    expect(keyFromStoredValue("diary/abc123.jpg")).toBe("diary/abc123.jpg")
  })

  test("leading slashes are stripped", () => {
    // "/diary/x.jpg" would otherwise produce an empty first path segment and
    // silently match nothing in the bucket.
    expect(keyFromStoredValue("/diary/abc.jpg")).toBe("diary/abc.jpg")
    expect(keyFromStoredValue("///diary/abc.jpg")).toBe("diary/abc.jpg")
  })

  test("an absolute URL on somebody else's host is NOT ours to delete", () => {
    expect(keyFromStoredValue("https://videodelivery.net/abc/manifest.m3u8")).toBeNull()
    expect(keyFromStoredValue("https://example.com/photo.jpg")).toBeNull()
  })

  test("empty and malformed values are null rather than a throw", () => {
    for (const bad of ["", "   ", null, undefined, 42 as any, {} as any]) {
      expect(() => keyFromStoredValue(bad)).not.toThrow()
      expect(keyFromStoredValue(bad)).toBeNull()
    }
  })

  test("a query string is dropped from a public URL", () => {
    if (!BASE) { test.skip(); return }
    expect(keyFromStoredValue(`${BASE}/diary/abc.jpg?width=200`)).toBe("diary/abc.jpg")
  })

  test("a public URL becomes its key", () => {
    if (!BASE) { test.skip(); return }
    expect(keyFromStoredValue(`${BASE}/diary/abc.jpg`)).toBe("diary/abc.jpg")
  })
})

test.describe("the media column map", () => {
  test("covers every table that holds an upload", () => {
    // Pinned so that adding a table with a photo column is a deliberate act
    // with a failing test attached, rather than a file nobody deletes.
    const tables = MEDIA_COLUMNS.map(m => m.table)
    for (const expected of [
      "diary_entries", "qa_submissions", "defects", "incidents", "expenses",
      "walkthroughs", "walkthrough_clips", "rams_documents", "toolbox_talks",
    ]) {
      expect(tables, expected).toContain(expected)
    }
  })

  test("every entry names at least one column", () => {
    for (const m of MEDIA_COLUMNS) {
      expect(m.columns.length, m.table).toBeGreaterThan(0)
      for (const c of m.columns) expect(c, m.table).toMatch(/^[a-z_]+$/)
    }
  })

  test("no duplicate tables", () => {
    const tables = MEDIA_COLUMNS.map(m => m.table)
    expect(new Set(tables).size).toBe(tables.length)
  })

  test("both the url and the path column are collected where both exist", () => {
    // QA and defects store a public URL and the object key side by side.
    // Collecting only one of them leaves the file behind.
    const qa = MEDIA_COLUMNS.find(m => m.table === "qa_submissions")!
    expect(qa.columns).toContain("photo_url")
    expect(qa.columns).toContain("photo_path")
  })
})
