import { test, expect } from "@playwright/test"
import {
  TENANT_A, TENANT_B, assertOnlyTestTenants, baseUrl, createProbe, destroyProbe,
  isRefusal, serviceClient, type Probe,
} from "./harness"

/**
 * A4 -- audit pack share links.
 *
 * These are the only URLs in the product that hand a company's evidence to
 * somebody with no account at all. A main contractor gets a link and sees
 * signed-in times, worker names, photographs and safety records for a job.
 *
 * That makes the token the entire access control. Four things have to hold, and
 * a failure in any one of them is a different kind of bad:
 *
 *   - The token must not be guessable. If it is, every pack is public.
 *   - Revocation must work, or "revoke" is a button that lies.
 *   - Expiry must work, or a link sent to a contractor in 2026 still opens in
 *     2030 when they are working for a competitor.
 *   - The token must decide WHAT is shown. If the page takes a job id from the
 *     query string as well, a client with a link to one job can read them all.
 *
 * The last one is the one that gets built wrong, and it is the reason this
 * spec exists rather than a code read.
 */

let adminA: Probe | null = null
let jobA = ""
let jobB = ""
const created: string[] = []

async function makeJob(companyId: string, label: string): Promise<string> {
  assertOnlyTestTenants(companyId)
  const service = serviceClient()
  const { data, error } = await service
    .from("jobs")
    .insert({
      company_id: companyId,
      name: `[TEST] a4 ${label} ${Date.now()}`,
      // NOT NULL. Leaving it out made an earlier spec fail silently in setup.
      address: "",
      status: "active",
    })
    .select("id")
    .single()
  if (error || !data) throw new Error(`could not create job: ${error?.message}`)
  created.push((data as any).id)
  return (data as any).id
}

/** Mint a share the way the product does, as company A's admin. */
async function createShare(jobId: string, cookie: string) {
  const res = await fetch(`${baseUrl()}/api/audit/share`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ jobId }),
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

test.beforeAll(async () => {
  adminA = await createProbe(TENANT_A.id, "admin", "a4")
  jobA = await makeJob(TENANT_A.id, "own")
  jobB = await makeJob(TENANT_B.id, "other")
})

test.afterAll(async () => {
  const service = serviceClient()
  await service.from("audit_shares").delete().in("job_id", created)
  await service.from("jobs").delete().in("id", created)
  await destroyProbe(adminA)
})

test("the setup is real", () => {
  expect(adminA, "no probe; every assertion below would be vacuous").not.toBeNull()
  expect(jobA).toBeTruthy()
  expect(jobB).toBeTruthy()
})

test("A4: an admin can mint a link for their own job", async () => {
  const { status, body } = await createShare(jobA, adminA!.cookie)
  expect(status, JSON.stringify(body)).toBe(200)
  expect(body.url).toContain("/audit/")
  expect(body.expires_at).toBeTruthy()
})

test("A4: but not for another company's job", async () => {
  const { status } = await createShare(jobB, adminA!.cookie)
  expect(status, "company A minted a share link for company B's job").toBe(404)
})

test("A4: nor can a stranger mint one", async () => {
  const res = await fetch(`${baseUrl()}/api/audit/share`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId: jobA }),
  })
  expect(isRefusal(res.status)).toBe(true)
})

test("A4: the token is not guessable", async () => {
  const { body } = await createShare(jobA, adminA!.cookie)
  const token = String(body.url).split("/audit/")[1]
  // 32 random bytes as base64url is 43 characters. Anything materially
  // shorter, or anything that looks like a counter, a timestamp or a uuid, is
  // a token somebody can work out rather than one they have to be given.
  expect(token.length).toBeGreaterThanOrEqual(43)
  expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
  expect(token, "the token is a uuid, which is not 32 bytes of entropy")
    .not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/)

  // And two of them do not share a prefix, which would mean a counter or a
  // timestamp somewhere in the generator.
  const second = String((await createShare(jobA, adminA!.cookie)).body.url).split("/audit/")[1]
  expect(token.slice(0, 8)).not.toBe(second.slice(0, 8))
})

test("A4: a token nobody issued is refused", async () => {
  const res = await fetch(`${baseUrl()}/api/audit/report?shareToken=${"a".repeat(43)}&jobId=${jobA}`)
  expect(res.status).toBe(404)
})

test("A4: a live link opens", async () => {
  const { body } = await createShare(jobA, adminA!.cookie)
  const token = String(body.url).split("/audit/")[1]
  const res = await fetch(`${baseUrl()}/api/audit/report?shareToken=${token}`)
  // The control for the two tests below: they only mean something if a working
  // link is distinguishable from a revoked or expired one.
  expect(res.status, "a freshly minted link does not open").toBe(200)
})

test("A4: THE ONE THAT MATTERS -- the token decides the job, not the query string", async () => {
  // A client holding a link to job A adds ?jobId=<job B> and asks for somebody
  // else's evidence. If the route trusts the query string over the token, one
  // shared link is a key to every job in the system.
  const { body } = await createShare(jobA, adminA!.cookie)
  const token = String(body.url).split("/audit/")[1]

  const res = await fetch(`${baseUrl()}/api/audit/report?shareToken=${token}&jobId=${jobB}`)
  const html = await res.text()

  // Either it refuses, or it serves job A regardless of what was asked for.
  if (res.status === 200) {
    expect(html, "a share link served a job it was not issued for").not.toContain(jobB)
  } else {
    expect(isRefusal(res.status)).toBe(true)
  }
})

test("A4: revoking actually revokes", async () => {
  const { body } = await createShare(jobA, adminA!.cookie)
  const token = String(body.url).split("/audit/")[1]

  const del = await fetch(`${baseUrl()}/api/audit/share/${body.id}`, {
    method: "DELETE",
    headers: { Cookie: adminA!.cookie },
  })
  expect(del.status, "revoke failed").toBe(200)

  const res = await fetch(`${baseUrl()}/api/audit/report?shareToken=${token}`)
  expect(res.status, "a revoked link still serves the pack").toBe(410)
})

test("A4: another company cannot revoke your link", async () => {
  // Revocation is a write on somebody else's row, reached by id.
  const { body } = await createShare(jobA, adminA!.cookie)
  const adminB = await createProbe(TENANT_B.id, "admin", "a4b")
  expect(adminB).not.toBeNull()
  try {
    const del = await fetch(`${baseUrl()}/api/audit/share/${body.id}`, {
      method: "DELETE",
      headers: { Cookie: adminB!.cookie },
    })
    expect(del.status, "company B revoked company A's share link").toBe(404)
  } finally {
    await destroyProbe(adminB)
  }
})

test("A4: an expired link is refused", async () => {
  // Expiry is a stored date, so it is testable without waiting thirty days --
  // and worth testing, because "expires_at" that nothing reads is the most
  // common way this goes wrong.
  const { body } = await createShare(jobA, adminA!.cookie)
  const token = String(body.url).split("/audit/")[1]

  const service = serviceClient()
  const { error } = await service
    .from("audit_shares")
    .update({ expires_at: new Date(Date.now() - 86400000).toISOString() })
    .eq("id", body.id)
  expect(error, "could not age the link; the assertion below would be vacuous").toBeNull()

  const res = await fetch(`${baseUrl()}/api/audit/report?shareToken=${token}`)
  expect(res.status, "an expired link still serves the pack").toBe(410)
})

test("A4: the expiry is set, and is not years away", async () => {
  const { body } = await createShare(jobA, adminA!.cookie)
  const days = (Date.parse(body.expires_at) - Date.now()) / 86400000
  expect(days).toBeGreaterThan(0)
  // Thirty days in the product. A link that outlives the working relationship
  // it was issued for is the thing expiry exists to prevent.
  expect(days, `links live for ${Math.round(days)} days`).toBeLessThanOrEqual(31)
})

test("A4: listing links is scoped to your own company", async () => {
  await createShare(jobA, adminA!.cookie)
  const adminB = await createProbe(TENANT_B.id, "admin", "a4list")
  expect(adminB).not.toBeNull()
  try {
    const res = await fetch(`${baseUrl()}/api/audit/share?jobId=${jobA}`, {
      headers: { Cookie: adminB!.cookie },
    })
    const body = await res.json().catch(() => ({}))
    // Either refused, or an empty list. What must NOT come back is a token,
    // because a token is the credential itself -- leaking one through a list
    // endpoint is worse than leaking the report, since it keeps working.
    const shares = body?.shares || []
    expect(
      shares.length,
      `company B listed ${shares.length} of company A's share tokens`,
    ).toBe(0)
  } finally {
    await destroyProbe(adminB)
  }
})

test("A4: the public pack page does not leak a session", async () => {
  // It is served to anonymous visitors by design. It must not set a cookie
  // that would make a later request look authenticated.
  const { body } = await createShare(jobA, adminA!.cookie)
  const token = String(body.url).split("/audit/")[1]
  const res = await fetch(`${baseUrl()}/api/audit/report?shareToken=${token}`)
  const setCookie = res.headers.get("set-cookie") || ""
  expect(setCookie).not.toMatch(/sb-.*-auth-token/)
})
