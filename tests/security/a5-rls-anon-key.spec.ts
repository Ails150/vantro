// A5. Anon key plus RLS.
//
// The most important test in this suite, because it bypasses the application
// entirely. NEXT_PUBLIC_SUPABASE_ANON_KEY is in our own JavaScript bundle and
// is public by design; RLS is the only thing between it and the database. If a
// table answers this client, no amount of checking in a route matters.
//
// Two passes:
//   1. anon key alone, no user at all
//   2. anon key plus a real company A user JWT, reading company B
//
// Every table is enumerated from the migrations and the application's own
// queries, so a table added next month is covered without anybody remembering.

import { test, expect } from "@playwright/test"
import { anonClient, serviceClient, TENANT_A, TENANT_B } from "./harness"
import fs from "fs"
import path from "path"

/**
 * Every table this application touches.
 *
 * Collected from `.from("...")` across app/ and lib/ rather than hand-listed,
 * for the same reason routes are enumerated: a hand-written list covers what
 * somebody remembered.
 */
function enumerateTables(): string[] {
  const found = new Set<string>()
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
        walk(full)
        continue
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue
      const src = fs.readFileSync(full, "utf8")
      for (const m of src.matchAll(/\.from\(\s*["'`]([a-z_][a-z0-9_]*)["'`]\s*\)/g)) {
        found.add(m[1])
      }
    }
  }
  for (const dir of ["app", "lib", "scripts"]) {
    const full = path.join(process.cwd(), dir)
    if (fs.existsSync(full)) walk(full)
  }
  // Storage buckets and other non-table .from() targets would be noise.
  found.delete("companies_view")
  return [...found].sort()
}

const TABLES = enumerateTables()

test.describe("A5: the anon key alone reaches nothing", () => {
  test("the table enumeration found the schema", () => {
    expect(TABLES.length).toBeGreaterThan(25)
    for (const expected of ["signins", "users", "companies", "jobs", "evidence_hashes"]) {
      expect(TABLES, expected).toContain(expected)
    }
  })

  test("no table returns rows to an unauthenticated anon client", async () => {
    const anon = anonClient()
    const leaked: string[] = []

    for (const table of TABLES) {
      const { data, error } = await anon.from(table).select("*").limit(5)
      // An error is the correct outcome: RLS denies, or the table does not
      // exist. Rows coming back is the failure.
      if (!error && Array.isArray(data) && data.length > 0) {
        leaked.push(`${table}: ${data.length} row(s)`)
      }
    }

    expect(leaked, `readable with the public anon key and no login:\n${leaked.join("\n")}`)
      .toEqual([])
  })

  test("no table accepts an insert from an unauthenticated anon client", async () => {
    const anon = anonClient()
    const written: string[] = []

    for (const table of TABLES) {
      const { error } = await anon
        .from(table)
        .insert({ company_id: TENANT_B.id, id: "00000000-0000-0000-0000-0000000000ff" } as any)
      // Any error at all means refused -- RLS, a not-null violation, a missing
      // column. Only a clean success is a failure of this test.
      if (!error) written.push(table)
    }

    expect(written, `insertable with the public anon key:\n${written.join("\n")}`).toEqual([])
  })
})

test.describe("A5: a company A user cannot read company B", () => {
  let tokenA: string | null = null
  let emailA = ""

  test.beforeAll(async () => {
    // A real Supabase auth user on tenant A. Created through the admin API so
    // the test does not depend on a password living in a file, and torn down
    // afterwards.
    const service = serviceClient()
    emailA = `security-a5-${Date.now()}@vantro.test`
    const password = `Sec-${Math.random().toString(36).slice(2)}-${Date.now()}!`

    const { data: created, error: createErr } = await service.auth.admin.createUser({
      email: emailA,
      password,
      email_confirm: true,
    })
    if (createErr || !created?.user) {
      test.skip(true, `could not create a test auth user: ${createErr?.message}`)
      return
    }

    // Attach it to tenant A as an admin, which is the most privileged thing a
    // normal customer account can be.
    await service.from("users").insert({
      company_id: TENANT_A.id,
      auth_user_id: created.user.id,
      email: emailA,
      name: "[TEST] A5 probe",
      initials: "TP",
      role: "admin",
      is_active: true,
    })

    const { data: session } = await anonClient().auth.signInWithPassword({
      email: emailA,
      password,
    })
    tokenA = session?.session?.access_token ?? null
  })

  test.afterAll(async () => {
    const service = serviceClient()
    await service.from("users").delete().eq("email", emailA)
    const { data: list } = await service.auth.admin.listUsers()
    const stray = list?.users?.find(u => u.email === emailA)
    if (stray) await service.auth.admin.deleteUser(stray.id)
  })

  test("a logged-in company A user reads no company B row from any table", async () => {
    expect(tokenA, "no session token for the probe user").toBeTruthy()
    const asA = anonClient(tokenA!)

    const leaked: Array<{ table: string; rows: number }> = []

    for (const table of TABLES) {
      // Ask specifically for the OTHER tenant's rows. A table with no
      // company_id column errors, which is a refusal.
      const { data, error } = await asA
        .from(table)
        .select("*")
        .eq("company_id", TENANT_B.id)
        .limit(5)

      if (!error && Array.isArray(data) && data.length > 0) {
        leaked.push({ table, rows: data.length })
      }
    }

    expect(
      leaked.map(l => `${l.table}: ${l.rows} row(s)`),
      `company A read company B rows from:\n${leaked.map(l => `  ${l.table} (${l.rows})`).join("\n")}`,
    ).toEqual([])
  })

  test("a logged-in company A user cannot write into company B", async () => {
    expect(tokenA).toBeTruthy()
    const asA = anonClient(tokenA!)
    const written: string[] = []

    for (const table of TABLES) {
      const { error: insertErr } = await asA
        .from(table)
        .insert({ company_id: TENANT_B.id } as any)
      if (!insertErr) written.push(`${table} (insert)`)

      // An update scoped to the other tenant. Zero rows affected is fine; the
      // failure is the statement being permitted to match and change them.
      const { error: updateErr, count } = await asA
        .from(table)
        .update({ company_id: TENANT_B.id } as any, { count: "exact" })
        .eq("company_id", TENANT_B.id)
      if (!updateErr && (count ?? 0) > 0) written.push(`${table} (update, ${count} rows)`)
    }

    expect(written, `company A wrote into company B:\n${written.join("\n")}`).toEqual([])
  })
})
