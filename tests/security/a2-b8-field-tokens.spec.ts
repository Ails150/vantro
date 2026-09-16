// A2. A company A worker token against company B resources.
// B8. Field token forgery, tampering, expiry and revocation.
//
// Field tokens are a different mechanism from admin sessions and are tested
// separately for that reason: installer routes read Authorization: Bearer and
// verify a JWT signed with JWT_SECRET, while admin routes read a Supabase
// cookie and ignore the header entirely. Confusing the two produced a sweep
// that proved nothing earlier in this suite.

import { test, expect, type APIRequestContext } from "@playwright/test"
import jwt from "jsonwebtoken"
import {
  assertOnlyTestTenants, enumerateApiRoutes, required,
  serviceClient, TENANT_A, TENANT_B,
} from "./harness"

assertOnlyTestTenants(TENANT_A.id, TENANT_B.id)

/**
 * Field-token tests need a server whose JWT_SECRET we know.
 *
 * Production's signing secret is NOT on a developer machine -- verified: a
 * locally minted token is refused by production with 401 -- and that is the
 * correct posture, not a gap. But it means these specific tests cannot be run
 * against production, because we cannot mint a token it will accept.
 *
 * So they run against a local server started from .env.local, which uses the
 * same database. The logic under test (signature verification, expiry,
 * alg:none, is_active revocation, tenant scoping) is identical code; only the
 * key differs.
 *
 * FIELD_BASE_URL overrides it. In CI this should point at a preview deployment
 * built with a known test secret.
 */
function fieldBaseUrl(): string {
  return process.env.FIELD_BASE_URL || "http://localhost:3000"
}
const baseUrl = fieldBaseUrl

/** Mint a field token the way lib/auth.ts createFieldToken does. */
function mintToken(userId: string, companyId: string, opts: { expiresIn?: any } = {}) {
  return jwt.sign(
    { userId, companyId, subcontractorId: null },
    required("JWT_SECRET"),
    { expiresIn: opts.expiresIn ?? "10h" },
  )
}

let workerA: { id: string; token: string } | null = null
let tenantBMarkers: string[] = []
let tenantBIds: Record<string, string> = {}

test.beforeAll(async () => {
  const service = serviceClient()

  const [{ data: aWorkers }, { data: bJobs }, { data: bWorkers }, { data: bSignins }] =
    await Promise.all([
      service.from("users").select("id").eq("company_id", TENANT_A.id).eq("role", "installer").limit(1),
      service.from("jobs").select("id, name").eq("company_id", TENANT_B.id).limit(1),
      service.from("users").select("id, name").eq("company_id", TENANT_B.id).limit(1),
      service.from("signins").select("id").eq("company_id", TENANT_B.id).limit(1),
    ])

  const workerId = aWorkers?.[0]?.id
  if (workerId) workerA = { id: workerId, token: mintToken(workerId, TENANT_A.id) }

  tenantBIds = {
    defaultId: bJobs?.[0]?.id || TENANT_B.id,
    defaultToken: "probe",
    id: bJobs?.[0]?.id || TENANT_B.id,
    jobid: bJobs?.[0]?.id || TENANT_B.id,
    userid: bWorkers?.[0]?.id || TENANT_B.id,
    token: "probe",
  }
  tenantBMarkers = [
    TENANT_B.id, TENANT_B.name,
    bJobs?.[0]?.id, bJobs?.[0]?.name, bWorkers?.[0]?.id, bSignins?.[0]?.id,
  ].filter(Boolean) as string[]
})

async function callWithToken(
  request: APIRequestContext, token: string, method: string, url: string,
) {
  const opts: any = {
    failOnStatusCode: false,
    timeout: 30_000,
    headers: { Authorization: `Bearer ${token}` },
  }
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    opts.headers["Content-Type"] = "application/json"
    opts.data = {
      companyId: TENANT_B.id, company_id: TENANT_B.id,
      jobId: tenantBIds.jobid, userId: tenantBIds.userid, id: tenantBIds.id,
    }
  }
  const res = await (request as any)[method.toLowerCase()](url, opts)
  let body = ""
  try { body = await res.text() } catch { /* empty */ }
  return { status: res.status(), body }
}

test.describe("A2: a company A worker token reaches nothing of company B's", () => {
  test("the token actually authenticates (guard against a vacuous sweep)", async ({ request }) => {
    expect(workerA, "no installer on tenant A to mint a token for").toBeTruthy()
    const res = await request.get(`${baseUrl()}/api/installer/jobs`, {
      failOnStatusCode: false,
      headers: { Authorization: `Bearer ${workerA!.token}` },
    })
    // Must not be 401. If it is, every assertion below is meaningless.
    expect(res.status(), "the field token did not authenticate").not.toBe(401)
    expect(res.status()).toBeLessThan(500)
  })

  test("no installer route returns a company B identifier", async ({ request }) => {
    expect(workerA).toBeTruthy()
    expect(tenantBMarkers.length).toBeGreaterThan(1)

    const routes = enumerateApiRoutes(tenantBIds).filter(
      r => r.pattern.startsWith("/api/installer") ||
           ["/api/jobs", "/api/signin", "/api/signout", "/api/alerts", "/api/payroll"]
             .some(p => r.pattern.startsWith(p)),
    )
    expect(routes.length, "no installer-facing routes found").toBeGreaterThan(5)

    const leaks: string[] = []
    for (const route of routes) {
      for (const method of route.methods) {
        const url =
          `${baseUrl()}${route.path}` +
          `?companyId=${TENANT_B.id}&jobId=${tenantBIds.jobid}&userId=${tenantBIds.userid}`
        const { status, body } = await callWithToken(request, workerA!.token, method, url)
        const found = tenantBMarkers.filter(m => body.toLowerCase().includes(String(m).toLowerCase()))
        if (found.length > 0) {
          leaks.push(`${method} ${route.pattern} [${status}] leaked: ${found.join(", ")}`)
        }
      }
    }
    expect(leaks, `a tenant A worker reached tenant B data:\n${leaks.join("\n")}`).toEqual([])
  })

  test("a worker cannot sign in to another company's job", async ({ request }) => {
    expect(workerA).toBeTruthy()
    const res = await request.post(`${baseUrl()}/api/signin`, {
      failOnStatusCode: false,
      headers: {
        Authorization: `Bearer ${workerA!.token}`,
        "Content-Type": "application/json",
      },
      data: { jobId: tenantBIds.jobid, lat: 51.5, lng: -0.1 },
    })
    expect(res.status(), "a worker signed in to another tenant's job").not.toBe(200)

    // And nothing was written.
    const service = serviceClient()
    const { count } = await service
      .from("signins")
      .select("id", { count: "exact", head: true })
      .eq("user_id", workerA!.id)
      .eq("company_id", TENANT_B.id)
    expect(count ?? 0, "a cross-tenant signin row exists").toBe(0)
  })
})

test.describe("B8: token forgery, tampering, expiry and revocation", () => {
  test("a token with one byte altered is refused", async ({ request }) => {
    expect(workerA).toBeTruthy()
    const token = workerA!.token
    // Flip a character in the SIGNATURE. The payload stays valid, so anything
    // that decoded without verifying would still accept it.
    const parts = token.split(".")
    const sig = parts[2]
    const flipped = (sig[5] === "A" ? "B" : "A") + sig.slice(1)
    const tampered = `${parts[0]}.${parts[1]}.${flipped}`

    const res = await request.get(`${baseUrl()}/api/installer/jobs`, {
      failOnStatusCode: false,
      headers: { Authorization: `Bearer ${tampered}` },
    })
    expect(res.status(), "a tampered signature was accepted").toBe(401)
  })

  test("a token with an altered PAYLOAD is refused", async ({ request }) => {
    // The interesting forgery: keep a valid signature block but swap the
    // company id, which is what an attacker would actually try.
    expect(workerA).toBeTruthy()
    const parts = workerA!.token.split(".")
    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString())
    payload.companyId = TENANT_B.id
    const forgedPayload = Buffer.from(JSON.stringify(payload))
      .toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")
    const forged = `${parts[0]}.${forgedPayload}.${parts[2]}`

    const res = await request.get(`${baseUrl()}/api/installer/jobs`, {
      failOnStatusCode: false,
      headers: { Authorization: `Bearer ${forged}` },
    })
    expect(res.status(), "a re-signed company id was accepted").toBe(401)
  })

  test("an alg:none token is refused", async ({ request }) => {
    // The classic JWT attack. jsonwebtoken refuses it, but asserting it means
    // a future change of library cannot reintroduce it silently.
    expect(workerA).toBeTruthy()
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" }))
      .toString("base64url")
    const payload = Buffer.from(JSON.stringify({
      userId: workerA!.id, companyId: TENANT_B.id, exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString("base64url")

    const res = await request.get(`${baseUrl()}/api/installer/jobs`, {
      failOnStatusCode: false,
      headers: { Authorization: `Bearer ${header}.${payload}.` },
    })
    // 401 or 403 both mean refused. The distinction does not matter here; the
    // only failure is the request being SERVED.
    expect([401, 403], "an unsigned token was accepted").toContain(res.status())
  })

  test("an expired token is refused", async ({ request }) => {
    expect(workerA).toBeTruthy()
    const expired = mintToken(workerA!.id, TENANT_A.id, { expiresIn: "-1h" })
    const res = await request.get(`${baseUrl()}/api/installer/jobs`, {
      failOnStatusCode: false,
      headers: { Authorization: `Bearer ${expired}` },
    })
    expect(res.status(), "an expired token was accepted").toBe(401)
  })

  test("a token signed with the wrong secret is refused", async ({ request }) => {
    expect(workerA).toBeTruthy()
    const wrong = jwt.sign(
      { userId: workerA!.id, companyId: TENANT_A.id },
      "not-the-real-secret-not-even-close",
      { expiresIn: "1h" },
    )
    const res = await request.get(`${baseUrl()}/api/installer/jobs`, {
      failOnStatusCode: false,
      headers: { Authorization: `Bearer ${wrong}` },
    })
    expect(res.status()).toBe(401)
  })

  test("a token stops working once the worker is DEACTIVATED", async ({ request }) => {
    // The token is still cryptographically valid and unexpired. If nothing
    // checks is_active, a sacked worker keeps access until it expires.
    const service = serviceClient()
    const email = `security-b8-${Date.now()}@vantro.test`
    const { data: row } = await service
      .from("users")
      .insert({
        company_id: TENANT_A.id, email, name: "[TEST] b8 revocation",
        initials: "B8", role: "installer", is_active: true,
      })
      .select("id")
      .single()

    expect(row, "could not create the revocation probe").toBeTruthy()
    const token = mintToken((row as any).id, TENANT_A.id)

    const before = await request.get(`${baseUrl()}/api/installer/jobs`, {
      failOnStatusCode: false, headers: { Authorization: `Bearer ${token}` },
    })

    await service.from("users").update({ is_active: false }).eq("id", (row as any).id)

    const after = await request.get(`${baseUrl()}/api/installer/jobs`, {
      failOnStatusCode: false, headers: { Authorization: `Bearer ${token}` },
    })

    await service.from("users").delete().eq("id", (row as any).id)

    expect(before.status(), "the probe token never worked, so this proves nothing")
      .not.toBe(401)
    expect(
      after.status(),
      "a DEACTIVATED worker's token still works; nothing checks is_active on the request path",
    ).toBe(401)
  })
})
