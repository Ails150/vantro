// lib/audit/pack.ts
//
// Phase 1.2: turn one generated pack into a signed, verifiable record.
//
// Every audit surface goes through fetchAuditData (Phase 0.8), so the set of
// evidence a pack covers is exactly the set of rows that data layer returned.
// This module looks up the capture-time hash of each of those rows, builds a
// manifest over them, signs it, and writes it to audit_packs. The reference it
// returns is what the pack prints and what /verify answers about.

import type { AuditData } from "@/lib/audit/data"
import {
  buildManifest,
  canonicalJson,
  generatePackReference,
  signManifest,
  signingPublicKey,
  type EvidenceHashRow,
  type PackManifest,
} from "@/lib/audit/manifest"
import crypto from "crypto"
import { archivePackFiles, archiveUrl, type ArchiveResult } from "@/lib/audit/archive"

export type PackIntegrity = {
  reference: string
  merkleRoot: string
  signature: string | null
  /** False when AUDIT_SIGNING_KEY is not configured in this environment. */
  signed: boolean
  evidenceCount: number
  coverage: PackManifest["coverage"]
  generatedAt: string
  /** Phase 1.3. Absent on a reused share pack, whose files were archived when
   *  the pack was first issued. */
  archive?: ArchiveResult
  /** Source R2 key -> permanent archive URL, for every file this pack holds a
   *  copy of. The report swaps its expiring signed URLs for these, which is the
   *  whole point of archiving: a pack opened in eighteen months still shows its
   *  photographs. */
  archiveUrlByPath?: Record<string, string>
  /** Set when the record could not be built at all; the UI must say so rather
   *  than print an integrity block that means nothing. */
  error?: string
}

/** Strip the R2 public base off a stored URL to recover the object key that
 *  evidence_hashes.storage_path holds. Diary photos are stored as full URLs;
 *  QA and defect media keep a *_path alongside the URL. */
function storageKeyFromUrl(url: string | null | undefined): string | null {
  if (!url) return null
  if (!/^https?:\/\//i.test(url)) return url // already a key
  const base = process.env.CLOUDFLARE_R2_PUBLIC_URL
  if (base && url.startsWith(base)) return url.slice(base.replace(/\/$/, "").length + 1)
  return null
}

function collectSubjects(data: AuditData) {
  const entityIds = new Set<string>()
  const signinIds = new Set<string>()
  const paths = new Set<string>()

  const add = (rows: any[] | undefined) => {
    for (const r of rows || []) if (r?.id) entityIds.add(r.id)
  }
  add(data.signins)
  add(data.qa)
  add(data.diary)
  add(data.defects)
  add(data.variations)
  add(data.walkthroughs)

  for (const s of data.signins || []) if (s?.id) signinIds.add(s.id)

  for (const q of data.qa || []) {
    if (q?.photo_path) paths.add(q.photo_path)
    if (q?.video_path) paths.add(q.video_path)
  }
  for (const d of data.defects || []) {
    if (d?.photo_path) paths.add(d.photo_path)
    if (d?.video_path) paths.add(d.video_path)
  }
  for (const e of data.diary || []) {
    for (const u of e?.photo_urls || []) {
      const k = storageKeyFromUrl(u)
      if (k) paths.add(k)
    }
    const v = storageKeyFromUrl(e?.video_url)
    if (v) paths.add(v)
  }

  return {
    entityIds: [...entityIds],
    signinIds: [...signinIds],
    paths: [...paths],
  }
}

/**
 * Build, sign and store the pack record.
 *
 * Never throws. A pack that cannot be signed is still a pack the user asked
 * for, and refusing to render it because the integrity layer had a bad day
 * would be a worse outcome than rendering it and saying plainly that it is
 * unverified. Every failure path returns an `error` the UI is expected to show.
 */
export async function createPackRecord(args: {
  service: any
  data: AuditData
  companyId: string
  jobId: string
  viewType: string
  generatedBy: string | null
  shareId?: string | null
}): Promise<PackIntegrity | null> {
  const generatedAt = new Date().toISOString()
  const reference = generatePackReference(new Date(generatedAt))

  try {
    // A share link is one issued pack, not one per view. Without this, a client
    // refreshing the page would mint a new reference every time, and the
    // reference printed in the email they were sent would stop matching the
    // document they are looking at. The pack is fixed at the moment the link
    // was first opened; later evidence is deliberately not folded in, because a
    // pack is a claim about a point in time.
    if (args.shareId) {
      const { data: existing } = await args.service
        .from("audit_packs")
        .select("reference, merkle_root, signature, manifest, evidence_count, generated_at")
        .eq("share_id", args.shareId)
        .order("generated_at", { ascending: true })
        .limit(1)
        .maybeSingle()

      if (existing?.reference) {
        const m = existing.manifest as PackManifest | null
        return {
          reference: existing.reference,
          merkleRoot: existing.merkle_root || "",
          signature: existing.signature || null,
          signed: !!existing.signature,
          evidenceCount: existing.evidence_count ?? m?.evidence?.count ?? 0,
          coverage: m?.coverage ?? { created: 0, signedOut: 0, amended: 0, backfill: 0, other: 0 },
          generatedAt: existing.generated_at || generatedAt,
        }
      }
    }

    const { entityIds, signinIds, paths } = collectSubjects(args.data)

    // Three lookups rather than one OR'd query: PostgREST composes `or` across
    // different columns awkwardly, and three narrow index hits are cheaper than
    // one that cannot use an index.
    const rows: EvidenceHashRow[] = []
    const select = "id, entity_type, entity_id, storage_path, sha256, event, row_count"

    if (entityIds.length) {
      const { data: r, error } = await args.service
        .from("evidence_hashes").select(select).in("entity_id", entityIds)
        .neq("entity_type", "location_logs_batch")
      if (error) throw error
      rows.push(...(r || []))
    }
    if (signinIds.length) {
      const { data: r, error } = await args.service
        .from("evidence_hashes").select(select)
        .eq("entity_type", "location_logs_batch").in("entity_id", signinIds)
      if (error) throw error
      rows.push(...(r || []))
    }
    if (paths.length) {
      const { data: r, error } = await args.service
        .from("evidence_hashes").select(select)
        .eq("entity_type", "file").in("storage_path", paths)
      if (error) throw error
      rows.push(...(r || []))
    }

    // Amendments mean an entity can have several hashes. All of them belong in
    // the manifest: the chain is the evidence, and dropping superseded rows
    // would hide exactly the corrections this phase exists to make visible.
    const manifest = buildManifest({
      reference,
      companyId: args.companyId,
      jobId: args.jobId,
      viewType: args.viewType,
      period: args.data.period,
      generatedAt,
      generatedBy: args.generatedBy,
      rows,
    })

    const signature = signManifest(manifest)
    const pub = signingPublicKey()
    const keyFingerprint = pub
      ? crypto.createHash("sha256").update(Buffer.from(pub, "base64")).digest("hex")
      : null

    const { error: insertErr } = await args.service.from("audit_packs").insert({
      company_id: args.companyId,
      job_id: args.jobId,
      period_from: args.data.period.from,
      period_to: args.data.period.to,
      generated_at: generatedAt,
      generated_by: args.generatedBy,
      reference,
      view_type: args.viewType,
      merkle_root: manifest.merkleRoot,
      signature,
      manifest,
      evidence_count: manifest.evidence.count,
      share_id: args.shareId || null,
      signing_key_sha256: keyFingerprint,
    })

    if (insertErr) {
      // The manifest is still correct and still worth showing; it just is not
      // registered, so /verify will not find it. Say exactly that.
      console.error("[audit] pack record not stored", reference, insertErr.message)
      return {
        reference,
        merkleRoot: manifest.merkleRoot,
        signature,
        signed: !!signature,
        evidenceCount: manifest.evidence.count,
        coverage: manifest.coverage,
        generatedAt,
        error: "Pack could not be registered; this reference will not resolve at /verify.",
      }
    }

    // Phase 1.3: copy every referenced file into this pack's archive prefix,
    // named by the hash of its own bytes. Done after the manifest is stored, so
    // a slow or failing archive cannot cost us the integrity record — the
    // manifest is the thing that must survive.
    const fileRows = rows.filter(r => r.entity_type === "file" && r.storage_path)
    const archive = await archivePackFiles({
      companyId: args.companyId,
      packRef: reference,
      subjects: fileRows.map(r => ({ sourceKey: r.storage_path as string, sha256: r.sha256 })),
    })

    if (archive.failed > 0) {
      await args.service.from("audit_packs")
        .update({ archive_failed_count: archive.failed })
        .eq("reference", reference)
    }

    // Only files that are actually in the archive get a permanent URL. A failed
    // copy keeps its expiring signed URL, which at least works today, rather
    // than a permanent-looking link to an object that was never written.
    const failed = new Set(archive.failedKeys)
    const archiveUrlByPath: Record<string, string> = {}
    for (const r of fileRows) {
      const key = r.storage_path as string
      if (failed.has(key)) continue
      const url = archiveUrl(args.companyId, reference, r.sha256, key)
      if (url) archiveUrlByPath[key] = url
    }

    return {
      reference,
      merkleRoot: manifest.merkleRoot,
      signature,
      signed: !!signature,
      evidenceCount: manifest.evidence.count,
      coverage: manifest.coverage,
      generatedAt,
      archive,
      archiveUrlByPath,
    }
  } catch (e: any) {
    console.error("[audit] pack record failed", reference, e?.message)
    return {
      reference,
      merkleRoot: "",
      signature: null,
      signed: false,
      evidenceCount: 0,
      coverage: { created: 0, signedOut: 0, amended: 0, backfill: 0, other: 0 },
      generatedAt,
      error: e?.message || "Integrity record could not be built.",
    }
  }
}

/** Exported for /verify, which must re-serialise a stored manifest exactly as
 *  it was signed. */
export { canonicalJson }
