import { test, expect } from "@playwright/test"
import fs from "fs"
import path from "path"
import {
  TENANT_A, TENANT_B, baseUrl, createProbe, destroyProbe, isRefusal,
  serviceClient, type Probe,
} from "./harness"

/**
 * A3 -- signed URLs for stored media.
 *
 * Photographs, receipts, RAMS PDFs and walkthrough video are the part of the
 * product least protected by row-level security, because a file is not a row.
 * Once a URL exists, whoever holds it has the file: the only controls are who
 * can get one minted, for which object, and for how long.
 *
 * So there are three questions, and they are different:
 *
 *   1. Can a signed-in user of company A have a URL minted for company B's
 *      object?
 *   2. Does the URL expire?
 *   3. Is the object reachable without a URL at all?
 *
 * THE FILES THIS TOUCHES ARE ITS OWN. It uploads a marker into a
 * security-test/ prefix and tries to steal that, rather than reaching for a
 * real customer's photograph, and removes it afterwards.
 */

const MEDIA_BUCKET = "vantro-media"
const PREFIX = "security-test"

let probeA: Probe | null = null
let victimPath = ""
const MARKER = `vantro-security-marker-${Date.now()}-${Math.random().toString(36).slice(2)}`

test.beforeAll(async () => {
  probeA = await createProbe(TENANT_A.id, "admin", "a3")

  // A file that is not company A's. The path is shaped like the bucket's own
  // layout -- a uuid folder -- so nothing about the test depends on the route
  // being lenient with unusual paths.
  victimPath = `${PREFIX}/${TENANT_B.id}/${MARKER}.txt`
  const service = serviceClient()
  const { error } = await service.storage
    .from(MEDIA_BUCKET)
    .upload(victimPath, new Blob([MARKER], { type: "text/plain" }), { upsert: true })
  if (error) throw new Error(`could not place the marker file: ${error.message}`)
})

test.afterAll(async () => {
  await destroyProbe(probeA)
  if (victimPath) {
    await serviceClient().storage.from(MEDIA_BUCKET).remove([victimPath]).catch(() => {})
  }
})

test("the setup is real", () => {
  // Without this, every assertion below passes when probe creation silently
  // failed -- which has happened in this suite before, twice.
  expect(probeA, "no probe; the isolation assertions would prove nothing").not.toBeNull()
  expect(victimPath).toContain(TENANT_B.id)
})

test("A3: company A cannot have a URL minted for company B's object", async () => {
  // THE WHOLE TEST. /api/media takes `path` from the query string and hands it
  // to createSignedUrl with the service role. If the only check is "are you
  // signed in", then every private photograph in the product is one request
  // away from every customer.
  const res = await fetch(`${baseUrl()}/api/media?path=${encodeURIComponent(victimPath)}`, {
    headers: { Cookie: probeA!.cookie },
  })

  const body = await res.text()
  expect(
    isRefusal(res.status),
    `signing another tenant's object was allowed: ${res.status} ${body.slice(0, 200)}`,
  ).toBe(true)
})

test("A3: and if one were minted, it would really work", async () => {
  // Proves the test above is testing something. A route that returns a URL
  // which 404s would technically leak nothing; this confirms the URL a signer
  // produces is live, so a refusal is worth having.
  const service = serviceClient()
  const { data, error } = await service.storage.from(MEDIA_BUCKET).createSignedUrl(victimPath, 60)
  expect(error).toBeNull()
  const fetched = await fetch(data!.signedUrl)
  expect(fetched.status).toBe(200)
  expect(await fetched.text()).toBe(MARKER)
})

test("A3: the object is not readable without a signature", async () => {
  // The bucket is private. If the public object endpoint serves it, signing is
  // theatre.
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${MEDIA_BUCKET}/${victimPath}`
  const res = await fetch(url)
  expect(res.status, "a private bucket served an object with no credential").not.toBe(200)
})

test("A3: an anonymous request cannot mint one either", async () => {
  const res = await fetch(`${baseUrl()}/api/media?path=${encodeURIComponent(victimPath)}`)
  expect(isRefusal(res.status)).toBe(true)
})

test("A3: path traversal does not escape the bucket", async () => {
  // Storage paths are strings. A route that concatenates without validating
  // lets ".." mean whatever the storage layer decides it means.
  const traversals = [
    `../${MEDIA_BUCKET}/${victimPath}`,
    `..%2F${victimPath}`,
    `/${victimPath}`,
    `${PREFIX}/../${PREFIX}/${TENANT_B.id}/${MARKER}.txt`,
  ]
  for (const p of traversals) {
    const res = await fetch(`${baseUrl()}/api/media?path=${encodeURIComponent(p)}`, {
      headers: { Cookie: probeA!.cookie },
    })
    expect(isRefusal(res.status), `traversal accepted: ${p} -> ${res.status}`).toBe(true)
  }
})

test.describe("every route that signs a URL", () => {
  // Scanned off the filesystem rather than listed, because a list is a list of
  // the signers somebody remembered. /api/media was one nobody remembered: it
  // had no callers in either repository and signed whatever path the query
  // string asked for.
  function signingFiles(): string[] {
    const out: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (["node_modules", ".next", ".git", "test-results"].includes(entry.name)) continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) { walk(full); continue }
        if (!/\.tsx?$/.test(entry.name)) continue
        const src = fs.readFileSync(full, "utf8")
        if (src.includes("createSignedUrl(")) out.push(path.relative(process.cwd(), full).replace(/\\/g, "/"))
      }
    }
    for (const root of ["app", "lib"]) walk(path.join(process.cwd(), root))
    return out.sort()
  }

  const FILES = signingFiles()

  test("the scan found the signers", () => {
    // Without this every assertion below passes on an empty list.
    expect(FILES.length, "nothing signs a URL any more; that is suspicious").toBeGreaterThan(2)
  })

  test("no signer takes its path from the request", () => {
    // The safe shape, which all the legitimate signers use, is to sign a path
    // read off a row that has already been fetched -- the authorisation
    // happened when the row was queried. Signing a path that arrived in the
    // request means the only check is whatever the route did beforehand, and
    // in /api/media's case that was "are you logged in".
    const offenders: string[] = []
    for (const file of FILES) {
      const src = fs.readFileSync(path.join(process.cwd(), file), "utf8")
      for (const call of src.match(/createSignedUrl\(([^,]+),/g) || []) {
        const arg = call.replace(/createSignedUrl\(/, "").replace(/,$/, "").trim()
        if (/searchParams|req\.|request\.|body\.|params\./.test(arg)) {
          offenders.push(`${file} signs "${arg}"`)
        }
      }
    }
    expect(offenders, offenders.join("; ")).toEqual([])
  })

  test("the expiry is short everywhere", () => {
    // A signed URL is a bearer credential. An hour is long enough to load a
    // page and short enough that a URL pasted into a chat is dead by the time
    // anybody else reads it.
    for (const file of FILES) {
      const src = fs.readFileSync(path.join(process.cwd(), file), "utf8")
      for (const m of src.matchAll(/createSignedUrl\([^,]+,\s*(\d+)/g)) {
        const ttl = Number(m[1])
        expect(ttl, `${file} signs for ${ttl}s`).toBeLessThanOrEqual(3600)
      }
    }
  })

  test("/api/media is gone and stays gone", () => {
    // Deleted rather than scoped. It had no callers anywhere in either
    // repository, and there is no ownership model for a storage path to scope
    // it against -- the safe signers all derive the path from a row they have
    // already authorised. Re-adding it would need one.
    expect(fs.existsSync(path.join(process.cwd(), "app", "api", "media", "route.ts"))).toBe(false)
  })
})

test.describe("the buckets themselves", () => {
  test("evidence buckets are private", async () => {
    // Signing only means anything if the object is not served without one.
    const { data, error } = await serviceClient().storage.listBuckets()
    expect(error).toBeNull()
    const byName = Object.fromEntries((data || []).map(b => [b.name, b]))
    for (const name of [MEDIA_BUCKET, "job-videos"]) {
      expect(byName[name], `bucket ${name} is missing`).toBeTruthy()
      expect(byName[name].public, `bucket ${name} is PUBLIC`).toBe(false)
    }
  })

  test("any public bucket is named and accounted for", async () => {
    // A public bucket is a decision, not an accident, and the set of them
    // should change only deliberately. diary-media is public and empty; if
    // another appears, or that one starts holding photographs, somebody has to
    // look at this test rather than find out later.
    const KNOWN_PUBLIC = new Set(["diary-media"])
    const { data } = await serviceClient().storage.listBuckets()
    const publicBuckets = (data || []).filter(b => b.public).map(b => b.name)
    for (const name of publicBuckets) {
      expect(KNOWN_PUBLIC.has(name), `bucket ${name} is public and undeclared`).toBe(true)
    }
  })
})
