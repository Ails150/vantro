// lib/variation-document.ts
//
// What a main contractor is shown when asked to sign a variation, and its hash.
//
// The capture hash on the variations row covers what the worker recorded. It
// deliberately does not cover the price -- the price is review state, set by an
// admin later -- so on its own it cannot prove what was agreed. This is the
// piece that does: one canonical document holding the worker's record (by its
// capture hash), the photographs (by the hashes of their bytes), and the price,
// hashed once when the link is sent and again when it is signed. The signature
// row stores that hash. If the two do not match, nothing is signed.
//
// Canonical form is JSON with keys sorted at every depth, so the same document
// always yields the same bytes regardless of the order anything was assembled
// in. `v` is the recipe version: bump it if the fields change, and old
// signatures stay recomputable under the old recipe.

import crypto from "crypto"
import { PAD_H, PAD_W, variationReference, toPence, type VariationKind } from "./variations"

export const DOCUMENT_VERSION = 1

export type VariationDocument = {
  v: number
  company: { id: string; name: string }
  job: { id: string; name: string; address: string | null; contractor: string | null }
  variation: {
    id: string
    reference: string
    kind: VariationKind
    description: string
    labourHours: number | null
    materials: string | null
    raisedBy: string | null
    raisedAt: string
    /** The worker's own figure, for context. The agreed price is `pricePence`. */
    estimatePence: number | null
    /** Latest evidence_hashes.sha256 for the variations row. */
    captureSha256: string | null
  }
  photos: Array<{ path: string; sha256: string | null }>
  pricePence: number
  currency: "GBP"
  sentTo: string
}

/** JSON with sorted keys at every level. Arrays keep their order: it is meaningful. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).filter(k => obj[k] !== undefined).sort()
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`
}

export function documentSha256(doc: VariationDocument): string {
  return crypto.createHash("sha256").update(canonicalJson(doc), "utf8").digest("hex")
}

/** 32 random bytes. The link carries this; the database only its hash. */
export function newShareToken(): string {
  return crypto.randomBytes(32).toString("base64url")
}

export function hashShareToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex")
}

/** Tokens are exactly 43 base64url characters. Anything else is not worth a query. */
export function isWellFormedToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token)
}

/**
 * Assemble the document for one variation from the database.
 *
 * Returns null if the variation has no price, because a document without one
 * is not something anybody can be asked to sign.
 */
export async function loadVariationDocument(
  service: any,
  variationId: string,
  sentTo: string,
): Promise<{ doc: VariationDocument; sha256: string; row: any } | null> {
  const { data: row } = await service
    .from("variations")
    .select(
      "id, company_id, job_id, kind, number, description, labour_hours, materials, " +
        "estimated_value, approved_value, status, created_at, photo_urls, photo_paths, " +
        "raised_by, sent_at, signed_at, declined_at, decline_reason, " +
        "raiser:users!variations_raised_by_fkey(name), " +
        "jobs(id, name, address, contractor, client_id), companies(id, name)",
    )
    .eq("id", variationId)
    .maybeSingle()
  if (!row) return null

  const pricePence = toPence(row.approved_value)
  if (pricePence === null) return null

  const paths: string[] = row.photo_paths || []
  const [{ data: capture }, { data: fileHashes }] = await Promise.all([
    service
      .from("evidence_hashes")
      .select("sha256")
      .eq("entity_type", "variations")
      .eq("entity_id", row.id)
      .order("hashed_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle(),
    paths.length
      ? service.from("evidence_hashes").select("storage_path, sha256").in("storage_path", paths)
      : Promise.resolve({ data: [] }),
  ])

  const byPath = new Map<string, string>()
  for (const h of fileHashes || []) byPath.set(h.storage_path, h.sha256)

  const doc: VariationDocument = {
    v: DOCUMENT_VERSION,
    company: { id: row.companies?.id || row.company_id, name: row.companies?.name || "" },
    job: {
      id: row.jobs?.id || row.job_id,
      name: row.jobs?.name || "",
      address: row.jobs?.address || null,
      contractor: row.jobs?.contractor || null,
    },
    variation: {
      id: row.id,
      reference: variationReference(row.kind, row.number),
      kind: row.kind === "daywork" ? "daywork" : "variation",
      description: row.description,
      labourHours: row.labour_hours === null || row.labour_hours === undefined ? null : Number(row.labour_hours),
      materials: row.materials || null,
      raisedBy: row.raiser?.name || null,
      raisedAt: new Date(row.created_at).toISOString(),
      estimatePence: toPence(row.estimated_value),
      captureSha256: capture?.sha256 || null,
    },
    photos: paths.map(p => ({ path: p, sha256: byPath.get(p) || null })),
    pricePence,
    currency: "GBP",
    sentTo: sentTo.trim().toLowerCase(),
  }

  return { doc, sha256: documentSha256(doc), row }
}

/**
 * Draw a signature SVG from stroke coordinates, or null if they are not a
 * plausible signature. The server draws it so that nothing a stranger sends is
 * ever stored as markup: numbers are range-checked and formatted by us.
 */
export function strokesToSvg(raw: unknown): string | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 200) return null
  const paths: string[] = []
  let points = 0
  for (const stroke of raw) {
    if (!Array.isArray(stroke) || stroke.length === 0) continue
    const cmds: string[] = []
    for (let i = 0; i < stroke.length; i++) {
      const p = stroke[i]
      if (!Array.isArray(p) || p.length !== 2) return null
      const x = Number(p[0]), y = Number(p[1])
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > PAD_W || y > PAD_H) return null
      cmds.push(`${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`)
      points++
    }
    paths.push(`<path d="${cmds.join(" ")}"/>`)
  }
  // A dot is not a signature.
  if (points < 8 || points > 20000) return null
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PAD_W} ${PAD_H}" ` +
    `fill="none" stroke="#0A1A14" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">` +
    paths.join("") + `</svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`
}
