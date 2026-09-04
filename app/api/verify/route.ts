// app/api/verify/route.ts
//
// Phase 1.2: public pack verification.
//
// GET /api/verify?ref=VTR-YYYYMMDD-XXXXXXXX
//
// Answers four questions and nothing else: is the signature valid, what is the
// Merkle root, when was it generated, and how much evidence does it cover.
//
// WHAT IS DELIBERATELY NOT RETURNED
// No evidence content, no job name, no site, no person, no company. A pack
// reference is quoted in documents that travel — an insurer's file, an
// assessor's report, an email thread — and anyone holding one must be able to
// check it without that check leaking who the job was for or what was found.
// The reference is the only input and it is unguessable (8 base32 characters on
// top of a date), but this endpoint is built as though it were guessable.

import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import {
  recomputeRoot,
  signingPublicKey,
  verifyManifest,
  type EvidenceHashRow,
  type PackManifest,
} from "@/lib/audit/manifest"
import { checkRateLimit } from "@/lib/rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const REFERENCE_RE = /^VTR-\d{8}-[0-9A-HJKMNP-TV-Z]{8}$/

export async function GET(request: Request) {
  const ip = (request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim()
  // Public and unauthenticated, so it is rate limited by IP. The reference
  // space is large, but an endpoint that says yes or no to a guess is worth
  // slowing down regardless.
  if (!(await checkRateLimit(`verify:ip:${ip}`, 60, 3600))) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 })
  }

  const ref = new URL(request.url).searchParams.get("ref")?.trim().toUpperCase() || ""

  // Shape-check before touching the database, so a malformed reference cannot
  // be used to probe timing.
  if (!REFERENCE_RE.test(ref)) {
    return NextResponse.json(
      { found: false, reason: "Not a valid pack reference." },
      { status: 400 }
    )
  }

  const service = await createServiceClient()
  const { data: pack, error } = await service
    .from("audit_packs")
    .select("reference, generated_at, merkle_root, signature, manifest, evidence_count, view_type, signing_key_sha256")
    .eq("reference", ref)
    .maybeSingle()

  if (error) {
    console.error("[verify] lookup failed", ref, error.message)
    return NextResponse.json({ error: "Verification unavailable." }, { status: 503 })
  }

  if (!pack) {
    return NextResponse.json({ found: false, reason: "No pack with that reference." }, { status: 404 })
  }

  const manifest = pack.manifest as PackManifest | null

  // Three independent checks. A pack is only "verified" if all three hold.
  //
  //  1. the signature covers the stored manifest
  //  2. the stored merkle_root matches the manifest's own
  //  3. the root recomputed from the evidence rows still matches
  //
  // Three matters because they fail differently. (1) alone would pass if
  // somebody rewrote merkle_root in the table; (3) is what catches evidence
  // being altered after the pack was issued.
  const signatureValid = !!manifest && !!pack.signature && verifyManifest(manifest, pack.signature)
  const rootMatchesManifest = !!manifest && manifest.merkleRoot === pack.merkle_root

  let evidenceIntact: boolean | null = null
  if (manifest?.evidence?.ids?.length) {
    const { data: rows } = await service
      .from("evidence_hashes")
      .select("id, entity_type, entity_id, storage_path, sha256, event")
      .in("id", manifest.evidence.ids)
    const found = (rows || []) as EvidenceHashRow[]
    evidenceIntact =
      found.length === manifest.evidence.ids.length &&
      recomputeRoot(found) === manifest.merkleRoot
  } else if (manifest) {
    evidenceIntact = manifest.evidence?.count === 0
  }

  const verified = signatureValid && rootMatchesManifest && evidenceIntact === true

  return NextResponse.json({
    found: true,
    reference: pack.reference,
    verified,
    checks: {
      signatureValid,
      rootMatchesManifest,
      evidenceIntact,
    },
    merkleRoot: pack.merkle_root,
    generatedAt: pack.generated_at,
    evidenceCount: pack.evidence_count,
    viewType: pack.view_type,
    // Coverage is the honest part: how much of this pack is capture-time
    // evidence versus backfilled or amended. A reader is entitled to know that
    // before treating the whole thing as proven from the moment of capture.
    coverage: manifest?.coverage ?? null,
    signingKeySha256: pack.signing_key_sha256,
    // Published so a reader can verify the signature themselves rather than
    // taking this endpoint's word for it.
    publicKey: signingPublicKey(),
    signature: pack.signature,
  })
}
