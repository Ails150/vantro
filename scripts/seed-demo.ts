// scripts/seed-demo.ts
//
// Builds one self-contained demo tenant: "Northbridge Glazing Ltd".
//
// SAFETY
// Every write is scoped to the demo company's id, and that id is only ever
// obtained by looking up DEMO_SLUG. purge() re-reads the company and refuses to
// delete anything unless the slug still matches, so a mistyped id cannot reach
// another tenant's rows. Nothing here takes a company id as an argument.
//
// IDEMPOTENT
// Re-running purges the demo company's own rows and rebuilds them. The result
// is the same shape every time, anchored to the day it runs so the demo always
// looks recent. Re-running is the supported way to reset the demo.
//
// WHERE IT RUNS
// The exported seedDemo() is called by POST /api/admin/seed-demo, which is
// superadmin-only. It has to run server-side rather than from a laptop because
// AUDIT_SIGNING_KEY lives in the Vercel environment: run locally without it and
// the Compliance Audit Pack is built correctly but comes out unsigned, which
// defeats the point of demoing it.
//
// ---------------------------------------------------------------------------
// UNSUPPORTED — asked for, deliberately not seeded
// ---------------------------------------------------------------------------
// Four requested items have no table in this schema, and seeding rows with no
// screen to show them makes a demo worse, not better. Listed here rather than
// silently dropped, and reported back by the API so the gap is visible in the
// UI too:
//
//   RAMS signed by all           no rams table
//   near miss                    no incidents table; diary_entries.ai_alert_type
//                                has no safety category (blocker | issue |
//                                variation | update | normal | none)
//   client dispute note          no dispute concept; nearest existing homes are
//                                `variations` or a flagged diary entry
//
// There is also no photos table: photographs live as URLs on
// diary_entries.photo_urls, defects.photo_url and qa_submissions.photo_url,
// which is where the twelve below are attached.

import crypto from "crypto"
import bcrypt from "bcryptjs"
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"
import { fetchAuditData } from "@/lib/audit/data"
import { createPackRecord } from "@/lib/audit/pack"
import { recordFileHash, sha256Hex } from "@/lib/evidence"

export const DEMO_SLUG = "northbridge-glazing-demo"
export const DEMO_COMPANY_NAME = "Northbridge Glazing Ltd"
export const DEMO_ADMIN_EMAIL = "demo+northbridge@getvantro.com"
export const DEMO_ADMIN_PASSWORD = process.env.DEMO_ADMIN_PASSWORD || "Northbridge!Demo2026"

export const UNSUPPORTED = [
  "1 RAMS signed by all - no rams table in this schema",
  "1 near miss - no incidents table; diary_entries has no safety alert category",
  "1 client dispute note with linked evidence - no dispute concept; nearest homes are variations or a flagged diary entry",
] as const

type Service = any

export type SeedResult = {
  companyId: string
  companyName: string
  admin: { email: string; password: string; name: string }
  workers: Array<{ name: string; email: string; pin: string }>
  sites: Array<{ name: string; town: string; jobId: string }>
  counts: Record<string, number>
  auditPack:
    | { reference: string; merkleRoot: string; signed: boolean; evidenceCount: number; error?: string }
    | { error: string }
  unsupported: readonly string[]
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------

/** Small seeded PRNG so a re-seed produces the same "random" texture. */
function rng(seed: string) {
  let h = crypto.createHash("sha256").update(seed).digest().readUInt32BE(0) || 1
  return () => {
    h ^= h << 13; h >>>= 0
    h ^= h >> 17
    h ^= h << 5; h >>>= 0
    return h / 0xffffffff
  }
}
const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length) % xs.length]

const iso = (d: Date) => d.toISOString()
const dateOnly = (d: Date) => d.toISOString().slice(0, 10)
function atLocal(day: Date, hh: number, mm: number): Date {
  // Demo tenant is Europe/London and the data is illustrative; building the
  // instant from the UTC date at the given wall-clock hour keeps sign-in and
  // sign-out an exact number of hours apart, which is what payroll figures in
  // the demo are read off.
  const d = new Date(day)
  d.setUTCHours(hh, mm, 0, 0)
  return d
}
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000)

// ---------------------------------------------------------------------------
// Demo cast
// ---------------------------------------------------------------------------

const WORKERS = [
  { name: "Marcus Vane", trade: "glazier" },
  { name: "Priya Raman", trade: "glazier" },
  { name: "Tom Ashworth", trade: "glazier" },
  { name: "Sian Okonjo", trade: "labourer" },
  { name: "Danny Fitzgerald", trade: "glazier" },
  { name: "Ellie Brandt", trade: "surveyor" },
  { name: "Ravi Chaudhary", trade: "labourer" },
  { name: "Joanne Petrie", trade: "glazier" },
] as const

const SITES = [
  {
    town: "Cambridge",
    name: "Eddington Court - curtain walling",
    address: "12 Eddington Avenue, Cambridge CB3 1SE",
    postcode: "CB3 1SE",
    lat: 52.2231, lng: 0.0959,
    start: "08:00:00", end: "16:30:00",
  },
  {
    town: "Ely",
    name: "Riverside Mews - window replacement",
    address: "4 Waterside, Ely CB7 4AU",
    postcode: "CB7 4AU",
    lat: 52.3993, lng: 0.2624,
    start: "07:30:00", end: "16:00:00",
  },
  {
    town: "Newmarket",
    name: "Rowley Park pavilion - glazed atrium",
    address: "Rowley Park, Newmarket CB8 0TG",
    postcode: "CB8 0TG",
    lat: 52.2432, lng: 0.4045,
    start: "08:00:00", end: "17:00:00",
  },
] as const

const DIARY_NORMAL = [
  "Bay 3 glazed and sealed. Two units left on the stillage for tomorrow.",
  "Silicone pointing finished along the west elevation.",
  "Scaffold handover signed off with the site manager this morning.",
  "Set out the head track for the atrium screens, checked level twice.",
  "Cleaned down and cleared the bay before leaving site.",
  "Delivered six sealed units, all checked against the schedule, no damage.",
  "Toolbox area tidied and materials moved under cover ahead of the rain.",
  "Second fix trims fitted to units 1 through 4.",
] as const
const DIARY_ISSUE = [
  "One unit arrived with a chipped edge, set aside and photographed for the supplier.",
  "Trickle vents missing from the Ely delivery, chased with the office.",
  "Scaffold boards short on the north side, flagged to the scaffolder.",
  "Access blocked by another trade until mid morning, lost around an hour.",
] as const
const DIARY_BLOCKER = [
  "No power to the site cabin, cannot run the saw. Waiting on the main contractor.",
  "Structural opening 40mm out of tolerance on the east bay, cannot glaze until it is corrected.",
  "Delivery did not arrive, nothing to install on the atrium today.",
] as const
const DIARY_VARIATION = [
  "Client asked for an additional opening light in the lobby screen, not on the drawing.",
  "Main contractor requested a change to the cill detail, priced separately.",
] as const
const DIARY_UPDATE = [
  "Progress at roughly 60 percent on the west elevation.",
  "Atrium frame complete, glazing starts Monday.",
] as const

// ---------------------------------------------------------------------------
// Photographs
// ---------------------------------------------------------------------------

/** A small labelled SVG, so the demo shows a picture rather than a broken icon.
 *  Deliberately obviously a placeholder: a demo that looks like real site
 *  photography invites someone to treat it as real evidence. */
function placeholderSvg(label: string, sub: string, hue: number): Buffer {
  const esc = (s: string) => s.replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!))
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">` +
      `<rect width="800" height="600" fill="hsl(${hue} 18% 22%)"/>` +
      `<rect x="40" y="40" width="720" height="520" fill="none" stroke="hsl(${hue} 30% 45%)" stroke-width="3" stroke-dasharray="14 10"/>` +
      `<text x="400" y="280" fill="hsl(${hue} 25% 82%)" font-family="system-ui,sans-serif" font-size="38" font-weight="700" text-anchor="middle">${esc(label)}</text>` +
      `<text x="400" y="330" fill="hsl(${hue} 20% 66%)" font-family="system-ui,sans-serif" font-size="24" text-anchor="middle">${esc(sub)}</text>` +
      `<text x="400" y="520" fill="hsl(${hue} 20% 55%)" font-family="system-ui,sans-serif" font-size="18" text-anchor="middle">DEMO DATA - not a real site photograph</text>` +
      `</svg>`,
    "utf8",
  )
}

/** A plausible drawn signature, so the admin view and the pack show a mark
 *  rather than an empty box. Obviously synthetic on close inspection, which is
 *  correct for demo data that sits next to real attestations. */
function demoSignature(seed: number): string {
  const rr = rng(`signature-${seed}`)
  let d = "M20 130"
  let x = 20
  for (let i = 0; i < 9; i++) {
    const cx1 = x + 10 + rr() * 14
    const cy1 = 130 - (30 + rr() * 60)
    const cx2 = x + 24 + rr() * 14
    const cy2 = 130 - (10 + rr() * 70)
    x += 34 + rr() * 12
    d += ` C${cx1.toFixed(0)} ${cy1.toFixed(0)}, ${cx2.toFixed(0)} ${cy2.toFixed(0)}, ${x.toFixed(0)} ${(105 + rr() * 25).toFixed(0)}`
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="200" viewBox="0 0 360 200">` +
    `<path d="${d}" fill="none" stroke="#111" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>`
  return "data:image/svg+xml;base64," + Buffer.from(svg, "utf8").toString("base64")
}

const R2_BUCKET = process.env.CLOUDFLARE_R2_BUCKET || "vantro-photos"

function r2Client(): S3Client | null {
  const { CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_R2_ACCESS_KEY_ID, CLOUDFLARE_R2_SECRET_ACCESS_KEY } = process.env
  if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_R2_ACCESS_KEY_ID || !CLOUDFLARE_R2_SECRET_ACCESS_KEY) return null
  return new S3Client({
    region: "auto",
    endpoint: `https://${CLOUDFLARE_ACCOUNT_ID}.eu.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: CLOUDFLARE_R2_ACCESS_KEY_ID,
      secretAccessKey: CLOUDFLARE_R2_SECRET_ACCESS_KEY,
    },
  })
}

type DemoPhoto = { url: string; key: string | null; sha256: string }

/**
 * Upload the demo photographs, recording each one's hash as file evidence so
 * the audit pack's manifest covers them the same way it covers a real site
 * photo. Falls back to a data: URI when R2 is not configured -- the demo still
 * renders, it just has no file evidence, and the caller is warned.
 */
async function makePhotos(
  ctx: { service: Service; companyId: string; userId: string; warnings: string[] },
  specs: Array<{ label: string; sub: string; hue: number }>,
): Promise<DemoPhoto[]> {
  const client = r2Client()
  const publicBase = (process.env.CLOUDFLARE_R2_PUBLIC_URL || "").replace(/\/$/, "")
  const out: DemoPhoto[] = []

  if (!client || !publicBase) {
    ctx.warnings.push(
      "R2 is not configured in this environment, so demo photographs are inline data: URIs. " +
        "They display, but carry no file evidence in the audit pack.",
    )
  }

  for (const [i, spec] of specs.entries()) {
    const bytes = placeholderSvg(spec.label, spec.sub, spec.hue)
    const sha = sha256Hex(bytes)

    if (!client || !publicBase) {
      out.push({ url: `data:image/svg+xml;base64,${bytes.toString("base64")}`, key: null, sha256: sha })
      continue
    }

    // Keyed by content hash: re-seeding overwrites the same object rather than
    // littering the bucket with a new copy on every run.
    const key = `demo/${ctx.companyId}/${sha.slice(0, 16)}.svg`
    await client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: bytes,
        ContentType: "image/svg+xml",
        Metadata: { "demo-seed": "northbridge", "company-id": ctx.companyId, seq: String(i) },
      }),
    )
    await recordFileHash({
      companyId: ctx.companyId,
      storagePath: key,
      sha256: sha,
      hashedBy: ctx.userId,
    })
    out.push({ url: `${publicBase}/${key}`, key, sha256: sha })
  }
  return out
}

/**
 * Get the demo admin's auth user, whatever state the last run left behind.
 *
 * Deleting a company's rows does not always take its auth users with it -- the
 * delete can fail, or a previous run can have been interrupted between creating
 * the auth user and creating the member row, which leaves an orphan that no
 * company_id scan will ever find. Either way the next run used to die on
 * "already registered".
 *
 * So: create if we can, and if the address is taken, adopt it and reset the
 * password to the documented one. Adoption is safe here precisely because the
 * address is a constant owned by this script.
 */
async function ensureAuthUser(
  service: Service,
  email: string,
  password: string,
  metadata: Record<string, any>,
  log: (s: string) => void,
): Promise<string> {
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: metadata,
  })
  if (!error && data?.user) return data.user.id

  const taken = /already been registered|already exists/i.test(error?.message || "")
  if (!taken) throw new Error(`demo admin auth user failed: ${error?.message}`)

  log(`auth user ${email} already exists, adopting it`)
  // There is no getUserByEmail on the admin API, so page until we find it.
  // The demo address is a constant, so this runs once and finds it early.
  let found: any = null
  for (let page = 1; page <= 20 && !found; page++) {
    const { data: list, error: listErr } = await service.auth.admin.listUsers({ page, perPage: 200 })
    if (listErr) throw new Error(`could not list auth users: ${listErr.message}`)
    found = (list?.users || []).find((u: any) => (u.email || "").toLowerCase() === email.toLowerCase())
    if (!list?.users?.length || list.users.length < 200) break
  }
  if (!found) {
    throw new Error(
      `${email} is registered but could not be found in the first 4000 auth users; ` +
        "delete it by hand in Supabase and re-run.",
    )
  }

  const { error: updErr } = await service.auth.admin.updateUserById(found.id, {
    password,
    email_confirm: true,
    user_metadata: metadata,
  })
  if (updErr) throw new Error(`could not reset the demo admin password: ${updErr.message}`)
  return found.id
}

// ---------------------------------------------------------------------------
// Purge
// ---------------------------------------------------------------------------

/**
 * Delete everything belonging to the demo company, and nothing else.
 *
 * The company is looked up by slug and re-verified immediately before any
 * delete runs. Child tables are cleared before the parent so foreign keys
 * without ON DELETE CASCADE do not block it.
 */
async function purge(service: Service, log: (s: string) => void): Promise<void> {
  const { data: company } = await service
    .from("companies")
    .select("id, slug, name")
    .eq("slug", DEMO_SLUG)
    .maybeSingle()
  if (!company) return

  // Belt and braces: never delete against an id whose slug is not the demo's.
  if (company.slug !== DEMO_SLUG) {
    throw new Error(`refusing to purge ${company.id}: slug is "${company.slug}", not "${DEMO_SLUG}"`)
  }
  const companyId = company.id
  log(`purging existing demo company ${companyId}`)

  // Ordered child-first. Every one of these is filtered on company_id.
  const byCompany = [
    "toolbox_talk_signatures",
    "toolbox_talks",
    "notification_log",
    "location_logs",
    "evidence_hashes",
    "audit_packs",
    "audit_log",
    "alerts",
    "expenses",
    "qa_submissions",
    "defects",
    "variations",
    "diary_entries",
    "signins",
    "job_assignments",
    "time_off_entries",
    "user_shifts",
    "checklist_items",
    "checklist_templates",
    "jobs",
    "sites",
    "clients",
  ]
  for (const table of byCompany) {
    const { error } = await service.from(table).delete().eq("company_id", companyId)
    if (error) log(`  ${table}: ${error.message}`)
  }

  // Auth users for anyone in the company, then the member rows.
  const { data: members } = await service
    .from("users")
    .select("id, auth_user_id, email")
    .eq("company_id", companyId)
  for (const m of members || []) {
    if (!m.auth_user_id) continue
    const { error } = await service.auth.admin.deleteUser(m.auth_user_id)
    // Logged, not swallowed. A surviving auth user is exactly what made the
    // second run of this script fail with "already registered", and a bare
    // catch is why it took a re-run to notice.
    if (error) log(`  auth user ${m.email}: ${error.message}`)
  }
  await service.from("users").delete().eq("company_id", companyId)
  await service.from("companies").delete().eq("id", companyId)
  log("purge complete")
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

export async function seedDemo(
  service: Service,
  opts: { log?: (s: string) => void } = {},
): Promise<SeedResult> {
  const log = opts.log ?? (() => {})
  const warnings: string[] = []
  const counts: Record<string, number> = {}
  const r = rng("northbridge-glazing")

  await purge(service, log)

  // --- company ------------------------------------------------------------
  const weekdays = ["mon", "tue", "wed", "thu", "fri"] as const
  const defaultSchedule: Record<string, any> = { sat: { enabled: false }, sun: { enabled: false } }
  for (const d of weekdays) defaultSchedule[d] = { enabled: true, start: "08:00", end: "16:30" }

  const { data: company, error: coErr } = await service
    .from("companies")
    .insert({
      name: DEMO_COMPANY_NAME,
      slug: DEMO_SLUG,
      plan: "suite",
      vertical: "install",
      country_code: "GB",
      timezone: "Europe/London",
      setup_complete: true,
      onboarding_completed_at: iso(new Date()),
      default_schedule: defaultSchedule,
      default_working_days: [...weekdays],
      default_sign_in_time: "08:00:00",
      default_sign_out_time: "16:30:00",
      grace_period_minutes: 15,
      geofence_radius_metres: 150,
      background_gps_enabled: true,
      installer_limit: 25,
      address: "Unit 7, Nuffield Road, Cambridge CB4 1TF",
      contact_email: DEMO_ADMIN_EMAIL,
      phone: "01223 496040",
      multi_trade_enabled: true,
      ai_audit_enabled: true,
    })
    .select("id")
    .single()
  if (coErr || !company) throw new Error(`company insert failed: ${coErr?.message}`)
  const companyId: string = company.id
  log(`company ${companyId}`)

  // --- admin --------------------------------------------------------------
  const adminName = "Hannah Reeve"
  const authUserId = await ensureAuthUser(
    service,
    DEMO_ADMIN_EMAIL,
    DEMO_ADMIN_PASSWORD,
    { full_name: adminName, company_name: DEMO_COMPANY_NAME, demo: true },
    log,
  )

  const { data: admin, error: adminErr } = await service
    .from("users")
    .insert({
      company_id: companyId,
      email: DEMO_ADMIN_EMAIL,
      name: adminName,
      initials: "HR",
      role: "admin",
      is_active: true,
      auth_user_id: authUserId,
      working_days: [...weekdays],
    })
    .select("id")
    .single()
  if (adminErr || !admin) throw new Error(`demo admin member row failed: ${adminErr?.message}`)
  const adminId: string = admin.id

  // --- workers ------------------------------------------------------------
  const weeklySchedule: Record<string, any> = {
    sat: { working: false, sign_in: null, sign_out: null },
    sun: { working: false, sign_in: null, sign_out: null },
  }
  for (const d of weekdays) weeklySchedule[d] = { working: true, sign_in: "08:00", sign_out: "16:30" }

  const workers: Array<{ id: string; name: string; email: string; pin: string }> = []
  for (const [i, w] of WORKERS.entries()) {
    const email = `demo+nb${i + 1}@getvantro.com`
    const pin = String(1000 + ((i * 1379) % 9000))
    const { data: row, error } = await service
      .from("users")
      .insert({
        company_id: companyId,
        email,
        name: w.name,
        initials: w.name.split(" ").map(p => p[0]).join("").toUpperCase(),
        role: "installer",
        is_active: true,
        pin_hash: await bcrypt.hash(pin, 10),
        trades: [w.trade],
        working_days: [...weekdays],
        weekly_schedule: weeklySchedule,
        sign_in_time: "08:00:00",
        sign_out_time: "16:30:00",
        gps_tracking_acknowledged: true,
        gps_tracking_acknowledged_at: iso(new Date()),
      })
      .select("id")
      .single()
    if (error || !row) throw new Error(`worker ${w.name} failed: ${error?.message}`)
    workers.push({ id: row.id, name: w.name, email, pin })
  }
  counts.workers = workers.length

  // --- client + sites + jobs ----------------------------------------------
  const { data: client } = await service
    .from("clients")
    .insert({
      company_id: companyId,
      name: "Cavendish Estates",
      email: "projects@cavendish-estates.example",
      phone: "01223 555019",
      address: "1 Station Road, Cambridge CB1 2JD",
      portal_enabled: true,
    })
    .select("id")
    .single()

  const today = new Date()
  const windowStart = addDays(today, -42) // six weeks

  const jobs: Array<{ id: string; name: string; town: string; start: string; end: string; lat: number; lng: number }> = []
  for (const s of SITES) {
    const { data: site } = await service
      .from("sites")
      .insert({
        company_id: companyId,
        name: `${s.town} - ${s.town === "Cambridge" ? "Eddington Court" : s.town === "Ely" ? "Riverside Mews" : "Rowley Park"}`,
        address: s.address,
        postcode: s.postcode,
        client_name: "Cavendish Estates",
        lat: s.lat,
        lng: s.lng,
        is_active: true,
      })
      .select("id")
      .single()

    const { data: job, error: jobErr } = await service
      .from("jobs")
      .insert({
        company_id: companyId,
        site_id: site?.id ?? null,
        client_id: client?.id ?? null,
        name: s.name,
        address: s.address,
        lat: s.lat,
        lng: s.lng,
        status: "active",
        start_time: s.start,
        sign_out_time: s.end,
        start_date: dateOnly(windowStart),
        gps_source: "geocoded",
        geofence_radius_metres: 150,
        required_trades: ["glazier"],
        contractor: "Cavendish Estates",
        budget_hours: 640,
        created_by: adminId,
      })
      .select("id")
      .single()
    if (jobErr || !job) throw new Error(`job ${s.name} failed: ${jobErr?.message}`)
    jobs.push({ id: job.id, name: s.name, town: s.town, start: s.start, end: s.end, lat: s.lat, lng: s.lng })
  }
  counts.sites = jobs.length

  // Crews: workers 0-2 Cambridge, 3-5 Ely, 6-7 Newmarket, with the surveyor
  // on all three so the demo has someone who moves between sites.
  const crew: Record<string, string[]> = {
    [jobs[0].id]: [workers[0].id, workers[1].id, workers[2].id, workers[5].id],
    [jobs[1].id]: [workers[3].id, workers[4].id, workers[5].id],
    [jobs[2].id]: [workers[6].id, workers[7].id, workers[5].id],
  }
  for (const [jobId, ids] of Object.entries(crew)) {
    for (const userId of ids) {
      await service.from("job_assignments").insert({ company_id: companyId, job_id: jobId, user_id: userId })
    }
  }
  counts.assignments = Object.values(crew).reduce((a, b) => a + b.length, 0)

  // --- six weeks of sign-ins ----------------------------------------------
  // Week 3 (index 2) is the overtime week: everyone works long days on the
  // Newmarket atrium to hit a handover date.
  const OVERTIME_WEEK = 2
  let signinCount = 0
  let lateCount = 0
  const signinIdsByJob: Record<string, string[]> = {}

  for (let dayOffset = 42; dayOffset >= 1; dayOffset--) {
    const day = addDays(today, -dayOffset)
    const dow = day.getUTCDay()
    if (dow === 0 || dow === 6) continue
    const weekIndex = Math.floor((42 - dayOffset) / 7)
    const overtime = weekIndex === OVERTIME_WEEK

    for (const job of jobs) {
      const [sh, sm] = job.start.split(":").map(Number)
      const [eh, em] = job.end.split(":").map(Number)

      for (const userId of crew[job.id]) {
        // Roughly one day in nine is missed: leave, another site, or off sick.
        if (r() < 0.11) continue

        // Lateness: mostly on time, sometimes a few minutes, occasionally bad.
        const roll = r()
        const lateMinutes = roll < 0.72 ? 0 : roll < 0.93 ? Math.floor(r() * 12) + 1 : Math.floor(r() * 40) + 13
        if (lateMinutes > 0) lateCount++

        const inAt = atLocal(day, sh, sm + lateMinutes)
        const outAt = overtime ? atLocal(day, eh + 2, em + 30) : atLocal(day, eh, em + Math.floor(r() * 10))
        const hours = Math.round(((outAt.getTime() - inAt.getTime()) / 3600000) * 100) / 100

        const jitter = () => (r() - 0.5) * 0.0009
        const { data: si } = await service
          .from("signins")
          .insert({
            company_id: companyId,
            job_id: job.id,
            user_id: userId,
            signed_in_at: iso(inAt),
            signed_out_at: iso(outAt),
            hours_worked: hours,
            expected_sign_out_time: job.end,
            lat: job.lat + jitter(),
            lng: job.lng + jitter(),
            accuracy_metres: Math.floor(r() * 18) + 4,
            distance_from_site_metres: Math.floor(r() * 60) + 5,
            within_range: true,
            sign_out_lat: job.lat + jitter(),
            sign_out_lng: job.lng + jitter(),
            sign_out_accuracy_metres: Math.floor(r() * 18) + 4,
            sign_out_distance_metres: Math.floor(r() * 60) + 5,
            sign_out_within_range: true,
            signed_out_method: "manual",
            flagged: lateMinutes >= 13,
            flag_reason: lateMinutes >= 13 ? `Signed in ${lateMinutes} minutes after shift start` : null,
            crew_headcount: crew[job.id].length,
          })
          .select("id")
          .single()
        if (si) {
          signinCount++
          ;(signinIdsByJob[job.id] ||= []).push(si.id)
        }
      }
    }
  }
  counts.signins = signinCount
  counts.late_signins = lateCount
  counts.overtime_week_starting = 0 // replaced below with a readable marker
  delete counts.overtime_week_starting

  // --- holiday requests ----------------------------------------------------
  await service.from("time_off_entries").insert([
    {
      company_id: companyId,
      user_id: workers[1].id,
      start_date: dateOnly(addDays(today, 12)),
      end_date: dateOnly(addDays(today, 16)),
      type: "annual_leave",
      status: "approved",
      notes: "Half term, booked in January.",
      requested_by: workers[1].id,
      approved_by: adminId,
      approved_at: iso(addDays(today, -9)),
    },
    {
      company_id: companyId,
      user_id: workers[4].id,
      start_date: dateOnly(addDays(today, 26)),
      end_date: dateOnly(addDays(today, 30)),
      type: "annual_leave",
      status: "pending",
      notes: "Wedding in Galway, flights already booked.",
      requested_by: workers[4].id,
    },
  ])
  counts.holiday_requests = 2

  // --- photographs ---------------------------------------------------------
  const photoSpecs = [
    { label: "Eddington Court", sub: "West elevation, bays 1-4", hue: 205 },
    { label: "Eddington Court", sub: "Head track set out", hue: 205 },
    { label: "Eddington Court", sub: "Silicone pointing complete", hue: 205 },
    { label: "Eddington Court", sub: "Chipped unit, set aside", hue: 12 },
    { label: "Riverside Mews", sub: "Ground floor openings", hue: 150 },
    { label: "Riverside Mews", sub: "Trickle vent shortfall", hue: 12 },
    { label: "Riverside Mews", sub: "Scaffold handover", hue: 150 },
    { label: "Rowley Park", sub: "Atrium frame, north bay", hue: 265 },
    { label: "Rowley Park", sub: "Glazed roof lights in", hue: 265 },
    { label: "Rowley Park", sub: "Opening 40mm out of tolerance", hue: 12 },
    { label: "Rowley Park", sub: "QA - fixings torqued", hue: 265 },
    { label: "Rowley Park", sub: "QA - defect closed out", hue: 100 },
  ]
  const photos = await makePhotos({ service, companyId, userId: adminId, warnings }, photoSpecs)
  counts.photos = photos.length

  // --- diary entries -------------------------------------------------------
  // 40 entries with the AI classification already applied, weighted the way a
  // real six weeks reads: mostly normal, a scatter of issues, a few blockers.
  const diaryPlan: Array<{ type: string; pool: readonly string[]; urgency: number }> = []
  const mix = [
    { type: "normal", pool: DIARY_NORMAL, urgency: 1, n: 22 },
    { type: "issue", pool: DIARY_ISSUE, urgency: 2, n: 8 },
    { type: "blocker", pool: DIARY_BLOCKER, urgency: 3, n: 4 },
    { type: "variation", pool: DIARY_VARIATION, urgency: 2, n: 3 },
    { type: "update", pool: DIARY_UPDATE, urgency: 1, n: 3 },
  ]
  for (const m of mix) for (let i = 0; i < m.n; i++) diaryPlan.push({ type: m.type, pool: m.pool, urgency: m.urgency })

  let photoCursor = 0
  let diaryCount = 0
  for (const [i, plan] of diaryPlan.entries()) {
    const job = jobs[i % jobs.length]
    const userId = pick(r, crew[job.id])
    const day = addDays(today, -(41 - Math.floor((i / diaryPlan.length) * 40)))
    const at = atLocal(day, 9 + Math.floor(r() * 7), Math.floor(r() * 60))
    // Photographs go on the entries where a photograph is the point: the
    // damaged unit, the out-of-tolerance opening, the progress shots.
    const wantsPhoto = plan.type !== "normal" || i % 5 === 0
    const attached = wantsPhoto && photoCursor < photos.length ? [photos[photoCursor++].url] : []

    const { error } = await service.from("diary_entries").insert({
      company_id: companyId,
      job_id: job.id,
      user_id: userId,
      entry_text: pick(r, plan.pool),
      photo_urls: attached,
      ai_processed: true,
      ai_alert_type: plan.type,
      ai_summary:
        plan.type === "blocker"
          ? "Work stopped, needs a decision from the main contractor."
          : plan.type === "issue"
            ? "Progress affected but not stopped."
            : plan.type === "variation"
              ? "Possible change to scope, price separately."
              : "Routine progress.",
      ai_variation_detected: plan.type === "variation",
      is_client_request: plan.type === "variation",
      urgency: plan.urgency,
      lat: job.lat,
      lng: job.lng,
      created_at: iso(at),
      ...(plan.type === "blocker"
        ? { reply: "Spoken to the main contractor, they are on it. Move to the west bay meanwhile.", replied_at: iso(new Date(at.getTime() + 5400000)), replied_by: adminId }
        : {}),
    })
    if (!error) diaryCount++
  }
  counts.diary_entries = diaryCount

  // --- defect: raised, then closed ----------------------------------------
  const defectJob = jobs[2]
  const defectPhoto = photos[9] ?? photos[0]
  const raisedAt = addDays(today, -11)
  const { data: defect } = await service
    .from("defects")
    .insert({
      company_id: companyId,
      job_id: defectJob.id,
      user_id: workers[6].id,
      description:
        "Structural opening on the east bay is 40mm out of tolerance. Atrium screen will not sit square, cannot glaze until it is packed or cut back.",
      severity: "major",
      status: "resolved",
      photo_url: defectPhoto.url,
      photo_path: defectPhoto.key,
      created_at: iso(atLocal(raisedAt, 10, 20)),
      resolution_note:
        "Main contractor cut back the upstand and re-checked the line. Re-measured 3mm out across the opening, within tolerance. Screen glazed the following morning.",
      resolved_by: adminId,
      resolved_at: iso(atLocal(addDays(today, -8), 15, 5)),
    })
    .select("id")
    .single()
  counts.defects = defect ? 1 : 0

  // --- a QA checklist, so the pack has QA evidence too ---------------------
  const { data: template } = await service
    .from("checklist_templates")
    .insert({ company_id: companyId, name: "Glazing installation sign-off", requires_approval: true, frequency: "per_job" })
    .select("id")
    .single()

  const qaItems = [
    "Frame square and plumb, checked both diagonals",
    "Fixings torqued to specification",
    "Perimeter seal continuous, no gaps",
    "Glass free of chips, scratches and edge damage",
    "Trickle vents fitted and operating",
  ]
  const itemIds: string[] = []
  if (template) {
    for (const [i, label] of qaItems.entries()) {
      const { data: item } = await service
        .from("checklist_items")
        .insert({
          company_id: companyId,
          template_id: template.id,
          label,
          item_type: "pass_fail",
          sort_order: i,
          is_mandatory: true,
          requires_photo: i >= 3,
          trade: "glazier",
        })
        .select("id")
        .single()
      if (item) itemIds.push(item.id)
    }
    for (const job of jobs) {
      await service.from("job_checklists").insert({ job_id: job.id, template_id: template.id })
    }
  }

  let qaCount = 0
  for (const [i, itemId] of itemIds.entries()) {
    const submittedAt = atLocal(addDays(today, -(6 - Math.floor(i / 2))), 14, 10 + i * 3)
    const withPhoto = i >= 3 ? photos[10 + (i - 3)] ?? null : null
    const { error } = await service.from("qa_submissions").insert({
      company_id: companyId,
      job_id: jobs[0].id,
      user_id: workers[0].id,
      checklist_item_id: itemId,
      template_id: template?.id ?? null,
      state: "pass",
      notes: null,
      photo_url: withPhoto?.url ?? null,
      photo_path: withPhoto?.key ?? null,
      submitted_at: iso(submittedAt),
      reviewed_by: adminId,
      reviewed_at: iso(new Date(submittedAt.getTime() + 3600000)),
    })
    if (!error) qaCount++
  }
  counts.qa_submissions = qaCount

  // --- toolbox talks -------------------------------------------------------
  // Two talks, deliberately in different states: one the whole crew signed, and
  // one with a name outstanding. A demo where everything is green does not show
  // what the feature is for.
  const TALKS = [
    {
      job: jobs[0],
      title: "Working at height - edge protection and harness checks",
      notes:
        "Covered: inspection of the scaffold handover certificate before first use, the three points of contact rule on ladders, " +
        "harness and lanyard pre-use checks, and the exclusion zone below the west elevation while units are being lifted. " +
        "Anyone finding a missing or damaged guard rail stops work and reports it before going any further.",
      daysAgo: 19,
      signAll: true,
    },
    {
      job: jobs[2],
      title: "Manual handling - glazed units and the vacuum lifter",
      notes:
        "Covered: two-person minimum on anything over 25kg, correct use of the vacuum lifter including the seal test before every " +
        "lift, keeping the load close and turning with the feet rather than the back, and clearing the route before picking up. " +
        "Report any near miss with the lifter the same day.",
      daysAgo: 6,
      signAll: false,
    },
  ]

  let talkCount = 0
  let signatureCount = 0
  let outstandingCount = 0
  for (const t of TALKS) {
    const deliveredAt = atLocal(addDays(today, -t.daysAgo), 7, 45)
    const { data: talk, error: talkErr } = await service
      .from("toolbox_talks")
      .insert({
        company_id: companyId,
        job_id: t.job.id,
        title: t.title,
        notes: t.notes,
        delivered_by: adminId,
        delivered_at: iso(deliveredAt),
        created_by: adminId,
      })
      .select("id")
      .single()
    if (talkErr || !talk) {
      warnings.push(`Toolbox talk "${t.title}" failed: ${talkErr?.message}`)
      continue
    }
    talkCount++

    // Signatures land a few minutes after the briefing, in crew order, which is
    // what a real sign-round looks like.
    const attendees = crew[t.job.id]
    const signers = t.signAll ? attendees : attendees.slice(0, Math.max(1, attendees.length - 1))
    for (const [i, userId] of signers.entries()) {
      const signedAt = new Date(deliveredAt.getTime() + (4 + i * 2) * 60000)
      const { error: sigErr } = await service.from("toolbox_talk_signatures").insert({
        company_id: companyId,
        talk_id: talk.id,
        user_id: userId,
        signature_svg: demoSignature(i),
        signed_at: iso(signedAt),
        lat: t.job.lat + (r() - 0.5) * 0.0006,
        lng: t.job.lng + (r() - 0.5) * 0.0006,
        accuracy_metres: Math.floor(r() * 15) + 5,
        device_info: "Demo seed",
      })
      if (sigErr) warnings.push(`Signature failed: ${sigErr.message}`)
      else signatureCount++
    }
    outstandingCount += attendees.length - signers.length
  }
  counts.toolbox_talks = talkCount
  counts.toolbox_signatures = signatureCount
  counts.toolbox_signatures_outstanding = outstandingCount

  // --- Compliance Audit Pack ----------------------------------------------
  // Generated through the real path so the manifest, merkle root and signature
  // are the genuine article and the reference resolves at /verify. Fabricating
  // these would produce a pack that fails the product's own verifier, which is
  // a worse demo than having no pack.
  let auditPack: SeedResult["auditPack"]
  try {
    const packJob = jobs[0]
    const data = await fetchAuditData(
      service,
      companyId,
      packJob.id,
      dateOnly(windowStart),
      dateOnly(today),
      { includeAdminLog: true },
    )
    if (!data) throw new Error("fetchAuditData returned nothing for the demo job")

    const record = await createPackRecord({
      service,
      data,
      companyId,
      jobId: packJob.id,
      viewType: "compliance",
      generatedBy: adminId,
    })
    if (!record) throw new Error("createPackRecord returned null")

    auditPack = {
      reference: record.reference,
      merkleRoot: record.merkleRoot,
      signed: record.signed,
      evidenceCount: record.evidenceCount,
      ...(record.error ? { error: record.error } : {}),
    }
    if (!record.signed) {
      warnings.push(
        "The audit pack is unsigned: AUDIT_SIGNING_KEY is not set in this environment. " +
          "Re-run the seed from the deployed app, where the key is configured.",
      )
    }
    counts.audit_packs = 1
  } catch (e: any) {
    auditPack = { error: e?.message || "unknown" }
    warnings.push(`Audit pack generation failed: ${e?.message || "unknown"}`)
  }

  log("seed complete")

  return {
    companyId,
    companyName: DEMO_COMPANY_NAME,
    admin: { email: DEMO_ADMIN_EMAIL, password: DEMO_ADMIN_PASSWORD, name: adminName },
    workers: workers.map(w => ({ name: w.name, email: w.email, pin: w.pin })),
    sites: jobs.map(j => ({ name: j.name, town: j.town, jobId: j.id })),
    counts,
    auditPack,
    unsupported: UNSUPPORTED,
    warnings,
  }
}
