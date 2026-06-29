# Phase 2 — Multi-Site Visits: Current-State Audit

**Date:** 2026-06-22
**Scope:** Audit only. No code, no migrations. Establishes what exists vs. what's missing
before building multi-site visits for the service-model segment (cleaning, security, FM,
retail maintenance) — where one client owns many sites and one worker visits several
sites in a day.

> **Meta-finding (read first):** There is **no committed DDL** in the repo for `sites`,
> `job_visits`, `visit_assignments`, or `client_users`. `docs/schema.sql` is only an
> introspection query and `docs/schema.csv` is an empty placeholder. These tables were
> created directly in the Supabase SQL editor and never committed. Every column list below
> is **reconstructed from the application code that reads/writes the tables** — it is the
> best available ground truth, but it is not authoritative. **Build step 0 must be: run
> `docs/schema.sql`, commit the real schema, and verify these reconstructions.**

---

## TL;DR

Phase 2 is **further along than it looks** — most of the data model already exists but is
only half-wired:

| Capability | State |
|---|---|
| `sites` table + full backend CRUD + CSV import | ✅ Exists |
| `sites` admin UI (`SitesTab.tsx`) | ⚠️ Built but **unreachable** (no sidebar entry) |
| `job_visits` / `visit_assignments` (dated visits) | ✅ Exists, drives the Calendar |
| Visit-based scheduling UI (drag-drop calendar) | ✅ Wired (`CalendarTab.tsx`) |
| `jobs.site_id` (job → site link) | ❌ Missing — jobs & sites are decoupled |
| Client/Account entity above sites | ❌ Missing — only free-text `client_name` |
| One-shift-per-person lock | ⚠️ Hard-coded job-centric (`signin/route.ts`) |
| Shift-reminder cron | ⚠️ **Job-centric** — root cause of the wrong-site reminder |

The hard work (tables, calendar, visit assignment) is done. The gaps are **linkage**
(`jobs.site_id`, a `clients` parent), and **two job-centric assumptions** (the sign-in
lock and the reminder cron) that must become visit/person-centric.

---

## 1. The `sites` table

**Exists** (in DB; no committed DDL). Reconstructed columns from
`app/api/admin/sites/route.ts`, `app/api/admin/sites/[id]/route.ts`, and the `Site`
interface in `components/admin/SitesTab.tsx:6`:

```
sites(
  id, company_id, name, address, postcode, client_name, notes,
  lat, lng, is_active, created_at, updated_at
)
```

- **Backend is complete:** list/create (`app/api/admin/sites/route.ts`), edit + soft-delete
  (`app/api/admin/sites/[id]/route.ts`), and CSV bulk import
  (`app/api/admin/sites/bulk-import/route.ts`). Create geocodes the address to lat/lng via
  Google Maps. Map tab also reads sites (`app/api/admin/map/route.ts`).
- **`client_name` is free text only** — there is **no `client_id` FK** (see §5).
- **UI is built but not reachable.** `components/admin/SitesTab.tsx` is a complete tab and
  is imported and rendered:
  - `components/admin/AdminDashboard.tsx:22` — `import SitesTab from "./SitesTab"`
  - `components/admin/AdminDashboard.tsx:2061` — `{activeTab === "sites" && <SitesTab />}`
  
  …but **neither the `setupTabs` nor `operationsTabs` arrays
  (`AdminDashboard.tsx:893–917`) contain a `sites` entry**, and nothing ever calls
  `setActiveTab("sites")`. So there is no button to open it — it's a dead render branch.
  The root-level `sites-tab.tsx.txt` (a `.txt`, not `.tsx`) is a parked older variant,
  consistent with this feature being deliberately collapsed out for v1.

**Verdict:** Not collapsed out of the *schema* — collapsed out of the *navigation*. Wiring
it back is a one-line tab-array change, but it's only useful once jobs/visits actually
reference sites (§5).

---

## 2. Visits / appointments concept

**Already exists and is in production use on the Calendar.** Two tables (reconstructed):

```
job_visits(
  id, company_id, job_id → jobs, start_at, end_at, status   -- status e.g. "scheduled"
)
visit_assignments(
  id, company_id, visit_id → job_visits, user_id → users, role   -- role default "installer"
)
```

- A **visit is the dated schedulable unit**: `app/api/admin/visit-assignments/route.ts`
  finds-or-creates a `job_visits` row for a (job, date) then attaches a `visit_assignment`.
- The week-grid **Calendar reads these** (`app/api/admin/calendar/route.ts:57–76`) and the
  **drag-drop UI writes them** (`components/admin/CalendarTab.tsx` — POST/DELETE/PATCH at
  lines 224/244/271).
- The installer app already merges visits with legacy assignments
  (`app/api/installer/jobs/route.ts:15–50`).

**But the `job` is still the primary unit elsewhere.** A visit always belongs to exactly
one `job_id`, and a job carries its own location (§5). Two job-level concepts coexist with
the new visit model:

- **`job_assignments`** (legacy, job-level: `job_id, user_id, company_id`, no date) — still
  the access-control list ("which installers can see this job"): used in
  `installer/jobs/route.ts:16` and the dashboard's job-create/assign flow
  (`AdminDashboard.tsx:589`, `:823`). Coexists with `visit_assignments` (dated scheduling).
- **`signins`** are keyed to `job_id`, **not `visit_id`** (see §3).

> **⚠️ Latent bug spotted (not fixed):** `app/api/installer/jobs/route.ts:19` does
> `.from('visit_assignments').select('visit_id, start_at, job_visits!inner(job_id)')
> .gte('start_at', …)` — it selects/filters `start_at` **directly on `visit_assignments`**,
> but every other code path treats `start_at` as a column of **`job_visits`**. If
> `visit_assignments` has no `start_at`, this query errors or silently returns nothing.
> Confirm against the real schema (build step 0). Likely should be
> `job_visits!inner(job_id, start_at)`.

---

## 3. The "one active job per installer" lock

**Enforced server-side in `app/api/signin/route.ts`, and it is job-centric.**

It is not a hard "sign out first" rejection. The invariant is **one open `signins` row
(`signed_out_at IS NULL`) per user**, maintained on each new sign-in
(`signin/route.ts:65–152`):

1. Look up the user's existing open sign-in (`:66–73`).
2. If it's the **same job, same day** → return `alreadySignedIn` (no-op) (`:79–109`).
3. If it's a **different job or an earlier day** → **auto-close the old one** (orphan
   handling, GPS-backdated, flagged) before inserting the new sign-in (`:111–152`).

Client-side, the installer app just treats the single open shift as *the* active job:
`app/installer/page.tsx:52` and `app/installer/jobs/page.tsx:57` do
`jobs.find(j => j.signed_in)` and set one `activeJob`.

**What must change for multiple visits/day:**
- `signins` needs a **`visit_id`** so a sign-in is scoped to a specific visit/site, not just
  a job (a job can now have several same-day visits at different sites).
- The auto-close-on-different-job branch (`:111–152`) must be **relaxed**: signing into
  site B should not auto-close site A unless the same visit/site is being re-entered.
  Decide the rule explicitly — either allow concurrent open shifts, or enforce
  "one open shift at a time" but let the worker close A and open B without it being flagged
  as an orphan.
- The installer UI must move from a single `activeJob` to a **list of today's visits** with
  per-visit sign-in/out state.

---

## 4. Shift-reminder cron — **this is the wrong-site bug**

**`lib/scheduling/notificationEngine.ts` (run by `app/api/notifications/cron/route.ts`).
The sign-in reminder path is job-centric; the sign-out path is per-shift.**

**Sign-in reminders (`notificationEngine.ts:161–252`) — job-centric:**
- Iterates **`jobs`** that have a single `start_time` (`:161–167`).
- Pulls **`job_assignments`** for the job (`:182`) — *not* `visit_assignments`.
- Idempotency is a single **`jobs.last_signin_reminder_date`** flag per job per day (`:177`).

This is exactly the reported failure mode: a job has **one** `start_time` and **one**
assignment list, with **no per-site/per-visit dimension**. If an installer has multiple
assignments/visits across sites, the reminder fires off the job's single start_time and
can't tell which site → "fired for the wrong site." It never consults `job_visits` /
`visit_assignments` at all.

**Sign-out reminders + auto-close (`:254–356`) — already per-shift:**
- Iterates open **`signins`** rows (per user+job) and uses each shift's
  `expected_sign_out_time`. This part is effectively person-centric and is fine as-is
  (it'll inherit `visit_id` automatically once §3 adds it).

**What must change:** rewrite the sign-in reminder loop to iterate **`job_visits` (with
`start_at`) joined to `visit_assignments`**, computing the reminder window per visit and
keying idempotency per **visit** (e.g. a `last_signin_reminder_at` on `job_visits` or a
sent-reminders table), not per job. The protected-user / time-off / resolver checks
(`:199–224`) can be reused unchanged.

---

## 5. Client / Account entity above sites

**Does not exist.** There is **no `clients` or `accounts` parent table** anywhere — not in
`migrations/`, not in any patch script, not referenced in any query. Sites group nothing:
`sites.client_name` is a **free-text label only** (`sites/route.ts:90`,
`sites/[id]/route.ts:47`; CSV importer example "Persimmon Homes").

`jobs` are **decoupled from sites**: there is **no working `jobs.site_id`**. A repo-wide
grep finds `site_id` only once, in a *comment* (`sites/[id]/route.ts:73`,
"jobs that reference this site keep working (site_id stays)") — aspirational, no code.
Jobs carry their own location inline: `jobs.address`, `jobs.lat`, `jobs.lng`
(`AdminDashboard.tsx:586`), and the calendar reads location off the job row, not a site.

> **Don't confuse with `/api/client/*`.** `app/api/client/route.ts`, `…/portal/route.ts`,
> `…/invite/route.ts` are an **external customer portal** — a `client_users` table with a
> JWT scoped to a **single `job_id`**, letting a customer view one job's diary/photos. It is
> not an account-grouping entity and groups no sites.

**For the service model** (one client → many sites), this is the central missing piece: a
parent **`clients`/`accounts`** table, with `sites.client_id → clients` and `jobs.site_id →
sites` (or visits pointing at sites directly).

---

## Recommended build order

Sequenced so each step is shippable and de-risks the next. **No step here is taken yet —
this is the plan.**

**0. Lock down the schema (prerequisite).**
Run `docs/schema.sql`, commit the real CSV, and **write committed migrations that capture
the existing `sites` / `job_visits` / `visit_assignments` DDL** (currently un-versioned).
While doing so, **verify the `visit_assignments.start_at` query** in
`installer/jobs/route.ts:19` (§2) and fix if it's reading a non-existent column.

**1. Introduce the parent entity (`clients`/`accounts`).**
New table `clients(id, company_id, name, …)`. Add `sites.client_id → clients`,
backfilling from the existing free-text `client_name`. Pure additive schema change; no
behaviour change yet. (§5)

**2. Link jobs/visits to sites (`jobs.site_id` or `visits.site_id`).**
Add `site_id` to the unit that carries location. Decide whether a **visit** points at a
site directly (best fit for "one worker, many sites in a day") or a job does. Backfill by
geocode/address match. Keep `address/lat/lng` as a fallback during transition. (§2, §5)

**3. Re-wire the Sites UI.**
Add the `sites` entry to `operationsTabs` in `AdminDashboard.tsx` (the tab already renders),
and surface client → sites grouping. Cheap once steps 1–2 give it meaning. (§1)

**4. Make the sign-in lock visit-scoped.**
Add `signins.visit_id`; relax the auto-close-on-different-job branch
(`signin/route.ts:111–152`) per the §3 decision; change the installer app from a single
`activeJob` to a per-visit today-list. (§3)

**5. Make the reminder cron visit/person-centric.**
Rewrite the sign-in reminder loop (`notificationEngine.ts:161–252`) to iterate
`job_visits` + `visit_assignments` with per-visit start times and per-visit idempotency.
This directly closes the wrong-site reminder bug. Sign-out/auto-close already inherits
`visit_id` from step 4. (§4)

**6. Multi-site day UX + scheduling polish.**
Installer "today's route" across sites; admin assign-one-worker-to-several-sites flows on
the calendar (the `visit_assignments` plumbing already supports this — mostly UI).

**Suggested first PR:** steps 0–1 (schema lock + `clients` table + `sites.client_id`
backfill) — additive, low-risk, and unblocks everything else.

---

### Open questions for product
- **Concurrency rule:** can a worker hold two *open* shifts at once (signed in at two sites),
  or strictly one-open-at-a-time with clean hand-off? Drives §3/§4 design.
- **Visit vs. job as the site-bearer:** should `site_id` live on the job (a job = work at one
  site) or the visit (a job can span sites)? The service model leans toward **visit→site**.
- **Legacy `job_assignments`:** keep as the job-level access list, or fold entirely into
  `visit_assignments`? Affects how much of the installer/cron code can be simplified.
