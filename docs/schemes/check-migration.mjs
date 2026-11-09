// Runs the real migration file against an in-process Postgres, over minimal
// stand-ins for the tables it depends on. argv: pglite entry, migration path.
import fs from "fs"
import { pathToFileURL } from "url"

const { PGlite } = await import(pathToFileURL(process.argv[2]).href)
const db = new PGlite()
const A = "aaaaaaaa-0000-0000-0000-000000000001", B = "bbbbbbbb-0000-0000-0000-000000000001"
const J = "cccccccc-0000-0000-0000-000000000001", J2 = "cccccccc-0000-0000-0000-000000000002"
let pass = 0, fail = 0
const ok = (name, cond, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  -> " + extra : ""}`) }
const errOf = async (sql, p) => { try { await db.query(sql, p); return null } catch (e) { return e } }

await db.exec(`
  create schema auth;
  create role anon; create role authenticated; create role service_role;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated;
  create table companies (id uuid primary key);
  create table users (id uuid primary key default gen_random_uuid(), auth_user_id uuid, company_id uuid references companies(id), role text);
  grant select on users to authenticated, anon;
  create table jobs (id uuid primary key, company_id uuid references companies(id), status text);
  create table evidence_hashes (id uuid primary key default gen_random_uuid(), company_id uuid, entity_type text, entity_id uuid, event text, sha256 text, payload_version int, hashed_by uuid);
  create function record_evidence_hash() returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
  declare row_json jsonb := to_jsonb(new);
  begin
    insert into evidence_hashes (company_id, entity_type, entity_id, event, sha256, payload_version, hashed_by)
    values ((row_json->>'company_id')::uuid, tg_table_name, (row_json->>'id')::uuid, tg_argv[0],
            encode(sha256(convert_to(row_json::text,'UTF8')),'hex'), tg_argv[1]::int, nullif(row_json->>tg_argv[2],'')::uuid);
    return null;
  end $fn$;
`)
await db.exec(fs.readFileSync(process.argv[3], "utf8"))
ok("migration applies", true)
await db.exec(fs.readFileSync(process.argv[3], "utf8"))
ok("migration re-applies cleanly", true)

await db.query("insert into companies values ($1),($2)", [A, B])
const uid = n => `dddddddd-0000-0000-0000-00000000000${n}`
await db.query(`insert into users (auth_user_id, company_id, role) values ($1,$2,'admin'),($3,$4,'admin'),($5,$2,'superadmin'),($6,$2,'foreman')`,
  [uid(1), A, uid(2), B, uid(3), uid(4)])
await db.query("insert into jobs (id, company_id, status, notifiable, registration_status) values ($1,$2,'completed',true,'pending'),($3,$2,'completed',true,'pending')", [J, A, J2])

const claim = async (j = J, co = A, chk = false) =>
  (await db.query("select * from claim_scheme_registration($1,$2,$3)", [co, j, chk])).rows[0]

ok("wrong company cannot claim", (await claim(J, B)).current_status === "not_found")
const c1 = await claim(), c2 = await claim()
ok("first claim wins", c1.claimed === true)
ok("second claim refused while in flight", c2.claimed === false && c2.current_status === "registering")

await db.query("update jobs set registration_status='failed' where id=$1", [J])
ok("failed can be claimed again", (await claim()).claimed === true)

await db.query("update jobs set registration_attempted_at = now() - interval '10 minutes' where id=$1", [J])
const stale = await claim()
ok("a stale attempt becomes unknown, not retryable", stale.claimed === false && stale.current_status === "unknown")
ok("unknown stays blocked without the check", (await claim()).claimed === false)
ok("unknown claims after the manual check", (await claim(J, A, true)).claimed === true)

const reg = `insert into scheme_registrations (company_id, job_id, scheme, environment, certificate_number, member_number, property_address, work_type, windows_count, doors_count, completion_date)
  values ($1,$2,'fensa','simulator',$3,'M1','14 Test Road','Replacement windows',6,1,'2026-11-02') returning id`
const r = (await db.query(reg, [A, J, "SIM-FENSA-1"])).rows[0]
ok("second record for the job refused", (await errOf(reg, [A, J, "SIM-FENSA-2"]))?.code === "23505")
ok("record cannot be edited", (await errOf("update scheme_registrations set certificate_number='X' where id=$1", [r.id]))?.code === "23001")
const hash = (await db.query("select * from evidence_hashes where entity_type='scheme_registrations' and entity_id=$1", [r.id])).rows
ok("one evidence hash written", hash.length === 1 && hash[0].event === "created" && /^[0-9a-f]{64}$/.test(hash[0].sha256))

await db.query("update jobs set certificate_number='SIM-FENSA-1' where id=$1", [J])
ok("certificate number is write-once", (await errOf("update jobs set certificate_number='OTHER' where id=$1", [J]))?.code === "23000")
ok("same value and other columns still update", (await errOf("update jobs set registration_error=null, certificate_number='SIM-FENSA-1' where id=$1", [J])) === null)

ok("bad status refused", (await errOf("update jobs set registration_status='nope' where id=$1", [J2]))?.code === "23514")
const conn = `insert into scheme_connections (company_id, scheme, api_key_encrypted, api_key_last4, member_number, active, validated_at) values ($1,$2,'v1:x','abcd','M1',$3,$4)`
ok("active without validation refused", (await errOf(conn, [A, "fensa", true, null]))?.code === "23514")
await db.query(conn, [A, "fensa", true, new Date().toISOString()])
await db.query(conn, [B, "fensa", true, new Date().toISOString()])
ok("one connection per scheme per company", (await errOf(conn, [A, "fensa", false, null]))?.code === "23505")

const COLS = "id, company_id, scheme, api_key_last4, member_number, active, validated_at, created_at, updated_at"
const as = async (role, n, sql) => {
  await db.exec(`set test.uid = '${n ? uid(n) : ""}'; set role ${role};`)
  try { return { rows: (await db.query(sql)).rows } } catch (e) { return { err: e } } finally { await db.exec("reset role;") }
}
const seen = async (role, n) => (await as(role, n, `select company_id from scheme_connections`.replace("company_id", COLS))).rows

ok("admin sees only own company", (await seen("authenticated", 1)).map(r => r.company_id).join() === A)
ok("other company's admin sees only theirs", (await seen("authenticated", 2)).map(r => r.company_id).join() === B)
ok("superadmin crosses companies", (await seen("authenticated", 3)).length === 2)
ok("foreman sees none", (await seen("authenticated", 4)).length === 0)
ok("anon is refused", !!(await as("anon", 0, `select ${COLS} from scheme_connections`)).err)
ok("sealed key not selectable by a session", (await as("authenticated", 1, "select api_key_encrypted from scheme_connections")).err?.code === "42501")
ok("browser session cannot write", (await as("authenticated", 1, `update scheme_connections set active=false`)).err?.code === "42501")
ok("registrations invisible to a browser session", (await as("authenticated", 1, "select id from scheme_registrations")).rows?.length === 0 || !!(await as("authenticated", 1, "select id from scheme_registrations")).err)
ok("session cannot call the claim", !!(await as("authenticated", 1, `select * from claim_scheme_registration('${A}','${J2}')`)).err)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
