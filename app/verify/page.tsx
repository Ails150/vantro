// app/verify/page.tsx
//
// Phase 1.2: the public verification page. Printed on page 1 of every pack as
// "Verify at getvantro.com/verify".
//
// Server-rendered, no client JavaScript, no session. Whoever holds a pack —
// an assessor, an insurer, a client's solicitor — types the reference and gets
// an answer that did not come from the document in front of them.
//
// It shows nothing about the job. See app/api/verify/route.ts for why.

import { redirect } from "next/navigation"
import { createServiceClient } from "@/lib/supabase/server"
import {
  recomputeRoot,
  signingPublicKey,
  verifyManifest,
  type EvidenceHashRow,
  type PackManifest,
} from "@/lib/audit/manifest"

export const dynamic = "force-dynamic"

const REFERENCE_RE = /^VTR-\d{8}-[0-9A-HJKMNP-TV-Z]{8}$/

type Result =
  | { state: "empty" }
  | { state: "malformed" }
  | { state: "notfound"; ref: string }
  | {
      state: "found"
      ref: string
      verified: boolean
      checks: { signatureValid: boolean; rootMatchesManifest: boolean; evidenceIntact: boolean | null }
      merkleRoot: string | null
      generatedAt: string | null
      evidenceCount: number | null
      coverage: PackManifest["coverage"] | null
    }

async function lookup(refRaw: string | undefined): Promise<Result> {
  const ref = (refRaw || "").trim().toUpperCase()
  if (!ref) return { state: "empty" }
  if (!REFERENCE_RE.test(ref)) return { state: "malformed" }

  const service = await createServiceClient()
  const { data: pack } = await service
    .from("audit_packs")
    .select("reference, generated_at, merkle_root, signature, manifest, evidence_count")
    .eq("reference", ref)
    .maybeSingle()

  if (!pack) return { state: "notfound", ref }

  const manifest = pack.manifest as PackManifest | null
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
      found.length === manifest.evidence.ids.length && recomputeRoot(found) === manifest.merkleRoot
  } else if (manifest) {
    evidenceIntact = manifest.evidence?.count === 0
  }

  return {
    state: "found",
    ref: pack.reference,
    verified: signatureValid && rootMatchesManifest && evidenceIntact === true,
    checks: { signatureValid, rootMatchesManifest, evidenceIntact },
    merkleRoot: pack.merkle_root,
    generatedAt: pack.generated_at,
    evidenceCount: pack.evidence_count,
    coverage: manifest?.coverage ?? null,
  }
}

function Check({ ok, label, detail }: { ok: boolean | null; label: string; detail: string }) {
  const mark = ok === true ? "PASS" : ok === false ? "FAIL" : "—"
  const colour = ok === true ? "#0f7b3d" : ok === false ? "#b3261e" : "#6b6b6b"
  return (
    <div style={{ display: "flex", gap: 12, padding: "10px 0", borderTop: "1px solid #eee" }}>
      <div style={{ minWidth: 52, fontWeight: 700, color: colour, fontSize: 12, letterSpacing: ".04em" }}>{mark}</div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 12, color: "#555", marginTop: 2 }}>{detail}</div>
      </div>
    </div>
  )
}

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>
}) {
  const { ref } = await searchParams
  const result = await lookup(ref)
  const publicKey = signingPublicKey()

  async function submit(formData: FormData) {
    "use server"
    const next = String(formData.get("ref") || "").trim()
    redirect(`/verify?ref=${encodeURIComponent(next)}`)
  }

  const mono: React.CSSProperties = {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    wordBreak: "break-all",
    fontSize: 12,
  }

  return (
    <main style={{ maxWidth: 680, margin: "0 auto", padding: "48px 20px", fontFamily: "system-ui, sans-serif", color: "#111" }}>
      <h1 style={{ fontSize: 22, margin: 0 }}>Verify an audit pack</h1>
      <p style={{ fontSize: 14, color: "#555", lineHeight: 1.6 }}>
        Enter the pack reference printed on page 1. This checks the pack against Vantro&apos;s
        records. It shows no details of the job, the site or the people on it.
      </p>

      <form action={submit} style={{ display: "flex", gap: 8, margin: "20px 0 8px" }}>
        <input
          name="ref"
          defaultValue={ref || ""}
          placeholder="VTR-20260904-XXXXXXXX"
          autoCapitalize="characters"
          style={{ flex: 1, padding: "10px 12px", fontSize: 14, border: "1px solid #ccc", borderRadius: 6, ...mono }}
        />
        <button type="submit" style={{ padding: "10px 18px", fontSize: 14, fontWeight: 600, border: 0, borderRadius: 6, background: "#111", color: "#fff", cursor: "pointer" }}>
          Verify
        </button>
      </form>

      {result.state === "malformed" && (
        <p style={{ color: "#b3261e", fontSize: 14 }}>That is not a valid pack reference. It looks like VTR-20260904-A1B2C3D4.</p>
      )}

      {result.state === "notfound" && (
        <div style={{ border: "1px solid #b3261e", borderRadius: 8, padding: 16, marginTop: 16 }}>
          <div style={{ fontWeight: 700, color: "#b3261e" }}>No pack with that reference</div>
          <p style={{ fontSize: 13, color: "#555", marginBottom: 0 }}>
            Vantro has no record of <span style={mono}>{result.ref}</span>. Either it was mistyped, or
            the document quoting it was not produced by Vantro.
          </p>
        </div>
      )}

      {result.state === "found" && (
        <div style={{ border: `1px solid ${result.verified ? "#0f7b3d" : "#b3261e"}`, borderRadius: 8, padding: 16, marginTop: 16 }}>
          <div style={{ fontWeight: 700, color: result.verified ? "#0f7b3d" : "#b3261e", fontSize: 16 }}>
            {result.verified ? "Verified" : "Not verified"}
          </div>
          <div style={{ fontSize: 13, color: "#555", marginTop: 4 }}>
            <span style={mono}>{result.ref}</span>
            {result.generatedAt && <> · issued {new Date(result.generatedAt).toLocaleString("en-GB")}</>}
            {typeof result.evidenceCount === "number" && <> · {result.evidenceCount} evidence records</>}
          </div>

          <div style={{ marginTop: 14 }}>
            <Check
              ok={result.checks.signatureValid}
              label="Signature"
              detail="The manifest was signed by Vantro and has not been altered since."
            />
            <Check
              ok={result.checks.rootMatchesManifest}
              label="Recorded root"
              detail="The root stored against this pack matches the one inside the signed manifest."
            />
            <Check
              ok={result.checks.evidenceIntact}
              label="Evidence unchanged"
              detail="Every record this pack covers is still present and still hashes to the same root."
            />
          </div>

          {result.merkleRoot && (
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #eee" }}>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".06em", color: "#777" }}>Merkle root</div>
              <div style={mono}>{result.merkleRoot}</div>
            </div>
          )}

          {result.coverage && (
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #eee" }}>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".06em", color: "#777", marginBottom: 4 }}>
                What this covers
              </div>
              <div style={{ fontSize: 13, color: "#333", lineHeight: 1.6 }}>
                {result.coverage.created + result.coverage.signedOut} records hashed at the moment of capture
                {result.coverage.backfill > 0 && (
                  <>
                    , {result.coverage.backfill} hashed later, when integrity hashing was introduced — for those,
                    this proves no change since then, <strong>not</strong> since capture
                  </>
                )}
                {result.coverage.amended > 0 && (
                  <>, and {result.coverage.amended} amendment{result.coverage.amended === 1 ? "" : "s"} recorded after capture</>
                )}
                .
              </div>
            </div>
          )}
        </div>
      )}

      {publicKey && (
        <details style={{ marginTop: 28 }}>
          <summary style={{ fontSize: 13, cursor: "pointer", color: "#555" }}>Check the signature yourself</summary>
          <p style={{ fontSize: 13, color: "#555", lineHeight: 1.6 }}>
            Signatures are Ed25519 over the canonical JSON of the manifest. The public key below is
            all you need to check one without trusting this page. <span style={mono}>GET /api/verify?ref=…</span>{" "}
            returns the manifest&apos;s signature and root as JSON.
          </p>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".06em", color: "#777" }}>Public key (SPKI DER, base64)</div>
          <div style={mono}>{publicKey}</div>
        </details>
      )}

      <p style={{ fontSize: 12, color: "#888", marginTop: 32 }}>
        Vantro · CNNCTD Ltd · Company No. NI695071
      </p>
    </main>
  )
}
