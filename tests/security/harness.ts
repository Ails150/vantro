// tests/security/harness.ts
//
// Shared machinery for the security suite.
//
// WHAT THIS SUITE IS. A standing, automated approximation of a penetration
// test: the checks a tester would run by hand on day one, written down so they
// run on every commit instead of once a year. It is NOT a substitute for a real
// engagement -- it cannot think of an attack nobody has written a test for --
// but it does stop a regression re-opening a hole that was already closed.
//
// WHERE IT RUNS. Against whatever SECURITY_BASE_URL points at, and directly
// against the database with the anon key. The default is production, which is
// deliberate and uncomfortable: an isolation test that passes against a local
// database with different RLS policies is worth nothing. Every write is
// confined to the two [TEST] tenants below, and assertOnlyTestTenants() is
// called by any spec that writes.
//
// THE TWO TENANTS. [TEST] Holts (A) and [TEST] Bannon (B) already existed as
// load-test fixtures, with a foreman and forty installers each. They are used
// rather than creating throwaway companies per run, because creating and
// destroying tenants against production on every CI run is a bigger risk than
// the one this suite is trying to manage, and because a company that persists
// accumulates the evidence rows these tests need to try to steal.

import { createClient } from "@supabase/supabase-js"
import fs from "fs"
import path from "path"

export const TENANT_A = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "[TEST] Holts Installations",
  slug: "test-holts",
}

export const TENANT_B = {
  id: "00000000-0000-0000-0000-000000000002",
  name: "[TEST] Bannon Roofing Ltd",
  slug: "test-bannon",
}

/** Never write outside these. */
const WRITEABLE = new Set([TENANT_A.id, TENANT_B.id])

export function assertOnlyTestTenants(...companyIds: string[]) {
  for (const id of companyIds) {
    if (!WRITEABLE.has(id)) {
      throw new Error(
        `Security suite refused to touch company ${id}. Only the [TEST] tenants are writeable.`,
      )
    }
  }
}

export function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set. See .env.e2e.example.`)
  return value
}

export function baseUrl(): string {
  return process.env.SECURITY_BASE_URL || process.env.E2E_BASE_URL || "https://app.getvantro.com"
}

/** Service-role client. Used only to SET UP a test, never to prove isolation. */
export function serviceClient() {
  return createClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  )
}

/**
 * Anon-key client, exactly what a browser has.
 *
 * This is the client the RLS tests use. Anything it can reach, a stranger with
 * the public key from our own JavaScript bundle can reach.
 */
export function anonClient(accessToken?: string) {
  return createClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      auth: { persistSession: false },
      global: accessToken
        ? { headers: { Authorization: `Bearer ${accessToken}` } }
        : undefined,
    },
  )
}

// ---------------------------------------------------------------------------
// Route enumeration
// ---------------------------------------------------------------------------
//
// Walked off the filesystem rather than listed by hand, because a hand-written
// list is a list of the routes somebody remembered. A route added next month
// with no auth check has to appear in this suite by itself or the suite is
// decorative.

export type Route = {
  /** URL path, with [param] segments left in place. */
  pattern: string
  /** Path with params filled in, ready to request. */
  path: string
  /** HTTP methods the file exports. */
  methods: string[]
  file: string
}

const API_ROOT = path.join(process.cwd(), "app", "api")

/** Substitutions for dynamic segments, so a route can actually be called. */
function fillParams(pattern: string, ids: Record<string, string>): string {
  return pattern.replace(/\[(\.\.\.)?([^\]]+)\]/g, (_m, _spread, name) => {
    const key = String(name).toLowerCase()
    if (ids[key]) return ids[key]
    if (key.includes("id")) return ids.defaultId
    return ids.defaultToken
  })
}

export function enumerateApiRoutes(ids: Record<string, string>): Route[] {
  const routes: Route[] = []

  const walk = (dir: string, urlPath: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        // Route groups (parentheses) do not appear in the URL.
        const segment = /^\(.+\)$/.test(entry.name) ? "" : `/${entry.name}`
        walk(full, urlPath + segment)
        continue
      }
      if (!/^route\.(ts|tsx|js)$/.test(entry.name)) continue

      const source = fs.readFileSync(full, "utf8")
      const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].filter(m =>
        new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\b`).test(source),
      )
      if (methods.length === 0) continue

      routes.push({
        pattern: urlPath || "/",
        path: fillParams(urlPath || "/", ids),
        methods,
        file: path.relative(process.cwd(), full).replace(/\\/g, "/"),
      })
    }
  }

  walk(API_ROOT, "/api")
  return routes.sort((a, b) => a.pattern.localeCompare(b.pattern))
}

/**
 * Routes that are PUBLIC by design and must not be asserted as protected.
 *
 * Each one is listed with why. This is the list most likely to be abused to
 * make a failing test pass, so anything added here needs a reason a reviewer
 * would accept.
 */
export const INTENTIONALLY_PUBLIC: Array<{ prefix: string; why: string }> = [
  { prefix: "/api/auth", why: "the sign-in exchange itself" },
  { prefix: "/api/signup", why: "creating an account, by definition unauthenticated" },
  { prefix: "/api/join", why: "a worker accepting an invite link" },
  { prefix: "/api/invite", why: "invite acceptance, token in the body" },
  { prefix: "/api/verify", why: "public evidence-pack verification" },
  { prefix: "/api/support/provision", why: "inbound support provisioning, secret in the body" },
  { prefix: "/api/billing/webhook", why: "Stripe calls it; authenticated by signature" },
  { prefix: "/api/stream", why: "media callback, authenticated by signature" },
]

export function isIntentionallyPublic(pattern: string): boolean {
  return INTENTIONALLY_PUBLIC.some(p => pattern === p.prefix || pattern.startsWith(p.prefix + "/"))
}

/** A body that satisfies "is there a body" without meaning anything. */
export const PROBE_BODY = { probe: true }

/**
 * Status codes that count as "refused".
 *
 * 404 counts: a route that hides the existence of another tenant's row is
 * refusing correctly, and insisting on 403 would push the product towards
 * confirming what exists. 405 counts because the method is not offered at all.
 * 400 counts only where the route refused before looking at auth, which is
 * noted at each call site that allows it. 410 counts because a retired endpoint
 * is a tombstone -- /api/billing/ai-audit answers one before it looks at
 * credentials, and it returns a product message rather than data.
 */
export const REFUSED = [400, 401, 403, 404, 405, 409, 410, 429, 501]

export function isRefusal(status: number): boolean {
  return REFUSED.includes(status)
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
//
// THE APP DOES NOT READ Authorization HEADERS. It uses @supabase/ssr, which
// reads a cookie. An earlier version of this suite sent bearer tokens, every
// route answered 401, and every isolation assertion passed trivially -- a
// security test that proves nothing while reporting success is worse than no
// test, so this is the one piece of machinery worth spelling out.
//
// The cookie is sb-<project-ref>-auth-token, whose value is "base64-" followed
// by the base64 of the session JSON.

export function projectRef(): string {
  return new URL(required("NEXT_PUBLIC_SUPABASE_URL")).hostname.split(".")[0]
}

export function sessionCookie(session: any): string {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64")
  return `sb-${projectRef()}-auth-token=base64-${payload}`
}

export type Probe = {
  email: string
  password: string
  authUserId: string
  userId: string
  companyId: string
  /** Ready to put in a Cookie header. */
  cookie: string
  /** The raw access token, for direct PostgREST calls. */
  token: string
}

/**
 * Create a throwaway auth user attached to a tenant, and sign it in.
 *
 * Returns null rather than throwing so a caller can skip with a reason. Every
 * caller MUST assert the probe exists rather than skipping silently -- a suite
 * that skips its own tests when setup breaks is a suite that reports green
 * while testing nothing.
 */
export async function createProbe(
  companyId: string,
  role: string,
  label: string,
): Promise<Probe | null> {
  assertOnlyTestTenants(companyId)
  const service = serviceClient()
  const email = `security-${label}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@vantro.test`
  const password = `Sec-${Math.random().toString(36).slice(2)}-${Date.now()}!`

  const { data: created, error } = await service.auth.admin.createUser({
    email, password, email_confirm: true,
  })
  if (error || !created?.user) return null

  const { data: row, error: rowErr } = await service
    .from("users")
    .insert({
      company_id: companyId,
      auth_user_id: created.user.id,
      email,
      name: `[TEST] ${label}`,
      // NOT NULL. Omitting it made every probe fail silently once already.
      initials: "TP",
      role,
      is_active: true,
    })
    .select("id")
    .single()

  if (rowErr || !row) {
    await service.auth.admin.deleteUser(created.user.id).catch(() => {})
    return null
  }

  const { data: session } = await anonClient().auth.signInWithPassword({ email, password })
  if (!session?.session) {
    await service.from("users").delete().eq("email", email)
    await service.auth.admin.deleteUser(created.user.id).catch(() => {})
    return null
  }

  return {
    email,
    password,
    authUserId: created.user.id,
    userId: (row as any).id,
    companyId,
    cookie: sessionCookie(session.session),
    token: session.session.access_token,
  }
}

export async function destroyProbe(probe: Probe | null) {
  if (!probe) return
  const service = serviceClient()
  await service.from("users").delete().eq("email", probe.email)
  await service.auth.admin.deleteUser(probe.authUserId).catch(() => {})
}
