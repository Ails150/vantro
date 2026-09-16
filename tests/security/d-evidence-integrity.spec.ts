// D16. Evidence is append-only, and tampering is visible.
// D17. An altered audit pack fails verification.
//
// This section is about the claim the product makes to a third party: that a
// compliance pack is evidence rather than a printout. If a row can be changed
// without trace, or a pack can be edited and still verify, that claim is false
// and every other security control is beside the point.
//
// The tests run against PRODUCTION's database with the SERVICE ROLE key, which
// is the strongest credential that exists. If the guarantees hold against that,
// they hold against anything. Every write is inside the [TEST] tenants.

import { test, expect } from "@playwright/test"
import crypto from "crypto"
import {
  anonClient, assertOnlyTestTenants, createProbe, destroyProbe,
  serviceClient, TENANT_A, type Probe,
} from "./harness"

assertOnlyTestTenants(TENANT_A.id)

/**
 * Evidence tables carrying an immutability trigger, with the column the trigger
 * refuses to let change.
 *
 * Taken from 20260904020000_evidence_append_only.sql. `immutable` is a column
 * the trigger names as permanently fixed; `payload` is an evidential field that
 * MAY change but must leave an `amended` hash behind when it does.
 */
const EVIDENCE = [
  { table: "signins", immutable: "company_id", payload: "flag_reason" },
  { table: "diary_entries", immutable: "company_id", payload: "entry_text" },
  { table: "qa_submissions", immutable: "company_id", payload: "notes" },
  { table: "defects", immutable: "company_id", payload: "description" },
]

let probe: Probe | null = null
let signinId: string | null = null
let createdJobId: string | null = null

test.beforeAll(async () => {
  probe = await createProbe(TENANT_A.id, "installer", "d16")
  const service = serviceClient()

  // A real evidence row to attack. Created through the service client because
  // the point is to prove the DATABASE refuses tampering, not the route.
  //
  // The [TEST] tenant has workers but no jobs, so one is created here and
  // removed in afterAll. A test that silently does nothing when its fixture is
  // missing is the failure mode this whole suite keeps tripping over, so the
  // guard test below asserts the row exists before anything else runs.
  let { data: job } = await service
    .from("jobs").select("id").eq("company_id", TENANT_A.id).limit(1).maybeSingle()

  if (!job) {
    const { data: created } = await service
      .from("jobs")
      .insert({
        company_id: TENANT_A.id,
        name: "[TEST] security evidence fixture",
        // address is NOT NULL on jobs. Every fixture in this suite has now
        // tripped over a different not-null column; the guard test below is
        // what turns that into a visible failure instead of a silent skip.
        address: "1 Test Street, Testville",
        status: "active",
      })
      .select("id")
      .single()
    job = created as any
    createdJobId = (created as any)?.id ?? null
  }

  if (probe && job) {
    const { data: row } = await service
      .from("signins")
      .insert({
        company_id: TENANT_A.id,
        user_id: probe.userId,
        job_id: (job as any).id,
        signed_in_at: new Date().toISOString(),
        // lat and lng are NOT NULL on signins.
        lat: 51.5,
        lng: -0.12,
        within_range: true,
      })
      .select("id")
      .single()
    signinId = (row as any)?.id ?? null
  }
})

test.afterAll(async () => {
  const service = serviceClient()
  if (signinId) {
    await service.from("evidence_hashes").delete().eq("entity_id", signinId)
    await service.from("signins").delete().eq("id", signinId)
  }
  if (createdJobId) await service.from("jobs").delete().eq("id", createdJobId)
  await destroyProbe(probe)
})

test.describe("D16: evidence cannot be altered without trace", () => {
  test("the probe evidence row exists (guard against a vacuous test)", () => {
    expect(probe, "no probe worker").toBeTruthy()
    expect(signinId, "no evidence row to attack, so nothing below proves anything")
      .toBeTruthy()
  })

  test("an immutable column cannot be changed, even by the service role", async () => {
    const service = serviceClient()
    // company_id is named immutable by the trigger. Changing it would move a
    // shift between tenants, which is the single most damaging edit possible.
    const { error } = await service
      .from("signins")
      .update({ company_id: "00000000-0000-0000-0000-000000000002" })
      .eq("id", signinId!)

    expect(error, "the service role moved an evidence row between tenants").toBeTruthy()
  })

  test("changing an evidential field leaves an 'amended' hash behind", async () => {
    const service = serviceClient()

    const { data: before } = await service
      .from("evidence_hashes").select("id, event, sha256").eq("entity_id", signinId!)
    const beforeCount = (before ?? []).length

    const { error } = await service
      .from("signins")
      // within_range, NOT flag_reason. The amendment trigger denylists
      // flag_reason, flagged, hours_worked and the notification bookkeeping --
      // correctly, they are admin housekeeping rather than evidence. An earlier
      // version of this test edited one of those, saw no amendment hash, and
      // would have reported a working guarantee as broken.
      .update({ within_range: false })
      .eq("id", signinId!)
    expect(error, `the update itself failed: ${error?.message}`).toBeFalsy()

    const { data: after } = await service
      .from("evidence_hashes").select("id, event, sha256").eq("entity_id", signinId!)

    // The whole guarantee: an edit is permitted, and it is RECORDED.
    expect(
      (after ?? []).length,
      "an evidential field changed and no amended hash was written",
    ).toBeGreaterThan(beforeCount)
    expect((after ?? []).some(h => (h as any).event === "amended")).toBe(true)
  })

  test("the recorded hash actually CHANGES when the row changes", async () => {
    // A trigger that writes a row but always the same digest would satisfy the
    // test above while proving nothing about the content.
    const service = serviceClient()

    const { data: before } = await service
      .from("evidence_hashes").select("sha256").eq("entity_id", signinId!)
      .order("hashed_at", { ascending: false }).limit(1)

    await service
      .from("signins")
      .update({ within_range: true })
      .eq("id", signinId!)

    const { data: after } = await service
      .from("evidence_hashes").select("sha256").eq("entity_id", signinId!)
      .order("hashed_at", { ascending: false }).limit(1)

    expect((after ?? [])[0], "no hash after the second edit").toBeTruthy()
    expect(
      (after as any)[0].sha256,
      "the digest did not change when the evidence did",
    ).not.toBe((before as any)?.[0]?.sha256)
  })

  test("an amended hash is CHAINED to the one it supersedes", async () => {
    // Without the chain an amendment is just another row, and the order of
    // edits -- which is the story an assessor reads -- is lost.
    const service = serviceClient()
    const { data: rows } = await service
      .from("evidence_hashes")
      .select("id, event, supersedes_id")
      .eq("entity_id", signinId!)
      .eq("event", "amended")
      .limit(5)

    expect((rows ?? []).length).toBeGreaterThan(0)
    for (const r of rows ?? []) {
      expect((r as any).supersedes_id, "an amendment with no predecessor").toBeTruthy()
    }
  })

  test("evidence_hashes itself cannot be rewritten to hide a change", async () => {
    // The obvious next move for an attacker who can already edit evidence.
    const service = serviceClient()
    const { data: existing } = await service
      .from("evidence_hashes").select("id, sha256").eq("entity_id", signinId!).limit(1)
    expect((existing ?? []).length).toBeGreaterThan(0)

    const { error: updateErr } = await service
      .from("evidence_hashes")
      .update({ sha256: crypto.randomBytes(32).toString("hex") })
      .eq("id", (existing as any)[0].id)

    expect(
      updateErr,
      "the hash chain can be rewritten, so an amendment can be hidden",
    ).toBeTruthy()
  })

  test("a direct PostgREST edit is still RECORDED as an amendment", async () => {
    // THE FINDING BEHIND THIS TEST. RLS on signins allows any authenticated
    // member of the company to UPDATE, so an admin or foreman can edit an
    // attendance row straight through PostgREST, bypassing every check in the
    // route layer. That is load bearing, not an oversight: the "sign everyone
    // out of this job" button in AdminDashboard.tsx:1026 is exactly such a
    // write, so tightening the policy would break a shipped feature and needs
    // that write moved to a server route first.
    //
    // What makes it survivable is that the amendment trigger fires REGARDLESS
    // of who did the writing. The guarantee is not "evidence cannot be edited";
    // it is "evidence cannot be edited WITHOUT A RECORD". That is what this
    // asserts, because asserting the stronger claim would be asserting
    // something untrue.
    expect(probe).toBeTruthy()
    const service = serviceClient()
    const asWorker = anonClient(probe!.token)

    const before = (await service
      .from("evidence_hashes").select("id").eq("entity_id", signinId!)).data ?? []

    const { error } = await asWorker
      .from("signins").update({ within_range: false }).eq("id", signinId!)
    expect(error, "the direct update failed, so this proves nothing").toBeFalsy()

    const after = (await service
      .from("evidence_hashes").select("id, event").eq("entity_id", signinId!)).data ?? []

    expect(
      after.length,
      "a direct PostgREST edit changed evidence and left NO hash behind",
    ).toBeGreaterThan(before.length)
    expect(after.some(h => (h as any).event === "amended")).toBe(true)
  })

  test("immutable columns are refused even through PostgREST", async () => {
    // The route layer is bypassed, so the DATABASE has to be the thing that
    // refuses. company_id is the one that matters: it would move a shift
    // between tenants.
    expect(probe).toBeTruthy()
    const asWorker = anonClient(probe!.token)
    const { error } = await asWorker
      .from("signins")
      .update({ company_id: "00000000-0000-0000-0000-000000000002" })
      .eq("id", signinId!)
    expect(error, "a worker moved a shift between tenants via PostgREST").toBeTruthy()
  })

  test("a worker's own token cannot DELETE evidence directly", async () => {
    expect(probe).toBeTruthy()
    const asWorker = anonClient(probe!.token)

    for (const { table } of EVIDENCE) {
      const { error: deleteErr, count: delCount } = await asWorker
        .from(table)
        .delete({ count: "exact" })
        .eq("company_id", TENANT_A.id)
      expect(
        !deleteErr && (delCount ?? 0) > 0,
        `${table}: a worker session DELETED evidence rows directly`,
      ).toBe(false)
    }
  })
})

test.describe("D17: a tampered audit pack fails verification", () => {
  test("the stored merkle root recomputes from the pack's own leaves", async () => {
    const service = serviceClient()

    // A real signed pack. READ ONLY: nothing here alters a customer's pack.
    const { data: packs } = await service
      .from("audit_packs")
      .select("id, reference, company_id, merkle_root, signature, manifest")
      .not("merkle_root", "is", null)
      .not("manifest", "is", null)
      .limit(1)

    const pack = (packs ?? [])[0] as any
    test.skip(!pack, "no signed pack exists yet to verify against")

    const manifest = pack.manifest
    expect(pack.merkle_root).toMatch(/^[0-9a-f]{64}$/)
    // The manifest carries its own copy of the root. If those two ever differ,
    // the signature and the register disagree about the same pack.
    expect(manifest.merkleRoot, "manifest root differs from the stored column")
      .toBe(pack.merkle_root)

    const ids: string[] = manifest.evidence?.ids ?? []
    expect(ids.length, "manifest lists no evidence").toBeGreaterThan(0)
    expect(manifest.evidence.count).toBe(ids.length)
    expect(manifest.evidence.leafOrder).toBe("leaf-sha256-asc")

    // Rebuild the leaves from the hash rows the manifest names, exactly as
    // lib/audit/manifest.ts does, and confirm the root comes out the same.
    const { data: rows } = await service
      .from("evidence_hashes")
      .select("id, entity_type, entity_id, storage_path, event, sha256")
      .in("id", ids)

    expect((rows ?? []).length, "the pack names hashes that no longer exist")
      .toBe(ids.length)

    const sha = (input: string) => crypto.createHash("sha256").update(input).digest("hex")
    const leafOf = (r: any) =>
      sha([r.entity_type, r.entity_id ?? r.storage_path ?? "", r.event, r.sha256].join(" "))
    const rootOf = (leaves: string[]) => {
      if (leaves.length === 0) return sha("")
      let level = [...leaves].sort()
      while (level.length > 1) {
        const next: string[] = []
        for (let i = 0; i < level.length; i += 2) {
          // Promote an odd node, never duplicate it -- duplicating is the
          // CVE-2012-2459 shape where two leaf sets share a root.
          next.push(i + 1 < level.length ? sha(level[i] + level[i + 1]) : level[i])
        }
        level = next
      }
      return level[0]
    }

    const leaves = (rows ?? []).map(leafOf)
    expect(
      rootOf(leaves),
      "the pack's merkle root does not recompute from the evidence it names",
    ).toBe(pack.merkle_root)

    // Now the actual tamper test: change ONE byte of ONE hash and confirm the
    // root moves. Done in memory -- the stored rows are untouched.
    const doctored = (rows ?? []).map((r, i) =>
      i === 0 ? { ...(r as any), sha256: "0" + (r as any).sha256.slice(1) } : r,
    )
    expect(
      rootOf(doctored.map(leafOf)),
      "altering an evidence hash left the merkle root unchanged",
    ).not.toBe(pack.merkle_root)
  })

  test("the public verify endpoint refuses a reference that does not exist", async ({ request }) => {
    const res = await request.get(
      "https://app.getvantro.com/api/verify?ref=VNT-0000-0000-FAKE",
      { failOnStatusCode: false },
    )
    const body = await res.text()
    // It must not claim an unknown pack is valid.
    expect(body.toLowerCase()).not.toMatch(/"valid"\s*:\s*true/)
  })

  test("a signed pack records which key signed it", async () => {
    // Without a key fingerprint, rotating the signing key silently invalidates
    // every previously issued pack with no way to tell which are affected.
    const service = serviceClient()
    const { data: packs } = await service
      .from("audit_packs")
      .select("reference, signature, signing_key_sha256")
      .not("signature", "is", null)
      .limit(5)

    test.skip(!(packs ?? []).length, "no signed packs to inspect")
    for (const p of packs ?? []) {
      expect(
        (p as any).signing_key_sha256,
        `pack ${(p as any).reference} is signed but records no key fingerprint`,
      ).toBeTruthy()
    }
  })
})
