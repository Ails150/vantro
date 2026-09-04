// lib/audit/manifest.ts
//
// Phase 1.2: pack manifest, Merkle root, and Ed25519 signature.
//
// WHAT THIS IS FOR
// A pack is a claim about evidence. Until now the only integrity marker on it
// was a SHA-256 computed in the reader's own browser, over a summary of the
// response the server had just sent (components/admin/AuditTab.tsx). That is
// circular: it proves the browser can hash what it was given, nothing more.
//
// A manifest is the opposite shape. It is built on the server, over the
// evidence_hashes rows that were written at capture time by database triggers,
// and it is signed with a key the browser never sees. A reader can hand the
// pack reference to /verify and get back an answer that did not come from the
// document they are holding.
//
// WHAT IT STILL DOES NOT PROVE
// The signature proves this server issued this manifest over these hashes. It
// does not prove the underlying rows were true when captured, and where the
// hashes are event='backfill' it does not even prove they are unchanged since
// capture -- only since the backfill ran. The manifest therefore carries a
// coverage breakdown by event, so a pack can state what it actually has instead
// of implying capture-time integrity across the board.

import crypto from "crypto"

export const MANIFEST_VERSION = 1 as const

/** Merkle root of an empty evidence set. Deliberately not sha256("") -- an
 *  all-zero root is unmistakable to a reader as "this pack covered nothing". */
export const EMPTY_MERKLE_ROOT = "0".repeat(64)

export type EvidenceHashRow = {
  id: string
  entity_type: string
  entity_id: string | null
  storage_path: string | null
  sha256: string
  event: string
  row_count?: number | null
}

export type PackCoverage = {
  created: number
  signedOut: number
  amended: number
  backfill: number
  other: number
}

export type PackManifest = {
  version: typeof MANIFEST_VERSION
  reference: string
  companyId: string
  jobId: string
  viewType: string
  period: { from: string | null; to: string | null }
  generatedAt: string
  generatedBy: string | null
  algorithm: "sha256"
  signatureAlgorithm: "ed25519"
  merkleRoot: string
  evidence: {
    count: number
    /** evidence_hashes.id, in the same order as the sorted Merkle leaves. */
    ids: string[]
    leafOrder: "leaf-sha256-asc"
  }
  /** How much of the above is capture-time evidence and how much is not. */
  coverage: PackCoverage
}

function sha256Hex(input: string | Buffer): string {
  return crypto.createHash("sha256").update(input).digest("hex")
}

/**
 * A leaf binds identity to content. Hashing the stored sha256 alone would let
 * two different rows with identical payloads collapse into one leaf, and would
 * not notice a hash being re-pointed at a different entity.
 *
 * The null byte is a separator that cannot occur in a uuid, an entity type or a
 * hex digest, so no two different tuples can render to the same string.
 */
export function evidenceLeaf(row: EvidenceHashRow): string {
  const subject = row.entity_id ?? row.storage_path ?? ""
  return sha256Hex([row.entity_type, subject, row.event, row.sha256].join("\0"))
}

/**
 * Merkle root over the leaves.
 *
 * Two choices worth stating, because both are places Merkle implementations go
 * wrong:
 *
 * 1. Leaves are sorted ascending before pairing. The database returns rows in
 *    whatever order it likes, and a root that depends on query order is not
 *    reproducible.
 * 2. An odd node at any level is PROMOTED to the next level, not duplicated.
 *    Duplicating the last node is the classic Bitcoin CVE-2012-2459 shape: two
 *    different leaf sets can produce the same root. Promotion has no such
 *    collision.
 */
export function merkleRoot(leaves: string[]): string {
  if (leaves.length === 0) return EMPTY_MERKLE_ROOT
  let level = [...leaves].sort()
  while (level.length > 1) {
    const next: string[] = []
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        next.push(sha256Hex(level[i] + level[i + 1]))
      } else {
        next.push(level[i]) // promote, never duplicate
      }
    }
    level = next
  }
  return level[0]
}

/**
 * Deterministic JSON. Key order in a JS object is not guaranteed to survive a
 * round trip through the database, and a signature over a re-serialised
 * manifest has to reproduce byte for byte or it fails for no reason.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]"
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return "{" + keys.map(k => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}"
}

function coverageOf(rows: EvidenceHashRow[]): PackCoverage {
  const c: PackCoverage = { created: 0, signedOut: 0, amended: 0, backfill: 0, other: 0 }
  for (const r of rows) {
    if (r.event === "created") c.created++
    else if (r.event === "signed_out") c.signedOut++
    else if (r.event === "amended") c.amended++
    else if (r.event === "backfill") c.backfill++
    else c.other++
  }
  return c
}

/**
 * Pack reference: what a reader quotes down a phone line, so it avoids the
 * characters that go wrong when read aloud or retyped. Crockford base32 without
 * I, L, O or U.
 */
export function generatePackReference(now = new Date()): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
  const day = now.toISOString().slice(0, 10).replace(/-/g, "")
  const bytes = crypto.randomBytes(8)
  let suffix = ""
  for (let i = 0; i < 8; i++) suffix += alphabet[bytes[i] % alphabet.length]
  return `VTR-${day}-${suffix}`
}

export function buildManifest(args: {
  reference: string
  companyId: string
  jobId: string
  viewType: string
  period: { from: string | null; to: string | null }
  generatedAt: string
  generatedBy: string | null
  rows: EvidenceHashRow[]
}): PackManifest {
  // Pair each leaf with its row id so ids can be emitted in leaf order. A
  // verifier rebuilding the tree from the id list then gets the same order
  // without having to re-sort against a rule it has to be told.
  const paired = args.rows
    .map(r => ({ leaf: evidenceLeaf(r), id: r.id }))
    .sort((a, b) => (a.leaf < b.leaf ? -1 : a.leaf > b.leaf ? 1 : 0))

  return {
    version: MANIFEST_VERSION,
    reference: args.reference,
    companyId: args.companyId,
    jobId: args.jobId,
    viewType: args.viewType,
    period: args.period,
    generatedAt: args.generatedAt,
    generatedBy: args.generatedBy,
    algorithm: "sha256",
    signatureAlgorithm: "ed25519",
    merkleRoot: merkleRoot(paired.map(p => p.leaf)),
    evidence: {
      count: paired.length,
      ids: paired.map(p => p.id),
      leafOrder: "leaf-sha256-asc",
    },
    coverage: coverageOf(args.rows),
  }
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------
// AUDIT_SIGNING_KEY is a base64 PKCS8 DER Ed25519 private key, set as a Vercel
// secret in production and preview. It is never sent to the browser and never
// written to the repo. The public key is derived from it at runtime rather than
// stored separately, so the two cannot drift apart.

function privateKey(): crypto.KeyObject | null {
  const raw = process.env.AUDIT_SIGNING_KEY
  if (!raw) return null
  try {
    return crypto.createPrivateKey({
      key: Buffer.from(raw, "base64"),
      format: "der",
      type: "pkcs8",
    })
  } catch (e: any) {
    console.error("[audit] AUDIT_SIGNING_KEY is set but unusable:", e?.message)
    return null
  }
}

/** Base64 SPKI DER. Safe to publish; /verify serves it so a reader can check a
 *  signature without trusting our verifier. */
export function signingPublicKey(): string | null {
  const priv = privateKey()
  if (!priv) return null
  return crypto.createPublicKey(priv).export({ type: "spki", format: "der" }).toString("base64")
}

/**
 * Sign the canonical manifest. Returns null when no key is configured, rather
 * than throwing: a missing signing key must not take down pack generation. An
 * unsigned pack is a real state and the UI says so plainly instead of showing a
 * signature that means nothing.
 */
export function signManifest(manifest: PackManifest): string | null {
  const priv = privateKey()
  if (!priv) return null
  const data = Buffer.from(canonicalJson(manifest), "utf8")
  // Ed25519 takes no digest algorithm; null is required here, not a default.
  return crypto.sign(null, data, priv).toString("base64")
}

export function verifyManifest(manifest: PackManifest, signature: string): boolean {
  const priv = privateKey()
  if (!priv || !signature) return false
  try {
    const data = Buffer.from(canonicalJson(manifest), "utf8")
    return crypto.verify(null, data, crypto.createPublicKey(priv), Buffer.from(signature, "base64"))
  } catch {
    return false
  }
}

/** Recompute the root from the manifest's own evidence rows. Used by /verify to
 *  check the stored root against the stored hashes, so a tampered manifest row
 *  fails even if its signature were somehow reproduced. */
export function recomputeRoot(rows: EvidenceHashRow[]): string {
  return merkleRoot(rows.map(evidenceLeaf))
}
