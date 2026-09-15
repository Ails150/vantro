// app/api/admin/retention/route.ts
//
// GET    every job on this company with retention on it, plus the totals.
// PATCH  set one job's retention terms, or mark it released.
//
// The figures are computed by lib/retention.ts and never in SQL. The job card,
// this list, the TODAY board and the claim letter all call the same functions
// over the same columns, so there is exactly one answer to "how much is held"
// and it is the one that has unit tests against it.

import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { getCallerContext } from "@/lib/company-context"
import { can, toPlan } from "@/lib/plan"
import {
  isOutstanding,
  londonToday,
  retentionFor,
  type RetentionState,
} from "@/lib/retention"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MANAGER_ROLES = ["admin", "superadmin", "support"]

// The columns retention needs off a job, in one place so the GET and the PATCH
// response cannot read different ones and disagree.
const JOB_FIELDS =
  "id, name, contractor, status, contract_value, retention_percent, " +
  "practical_completion_date, defects_period_months, retention_released_at, retention_released_by"

async function caller() {
  const ctx = await getCallerContext()
  if (!ctx) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  if (!MANAGER_ROLES.includes(ctx.role)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }
  if (!ctx.companyId) {
    return { error: NextResponse.json({ error: "No company selected" }, { status: 400 }) }
  }

  const service = await createServiceClient()
  const { data: company } = (await service
    .from("companies").select("id, plan").eq("id", ctx.companyId).single()) as { data: any }

  // Suite only. Checked on the server as well as hidden in the nav, because a
  // hidden tab is a suggestion and this endpoint is reachable directly.
  if (!can(toPlan(company?.plan), "retentionTracking")) {
    return {
      error: NextResponse.json(
        { error: "Retention tracking is on the Suite plan", requiredPlan: "suite" },
        { status: 402 },
      ),
    }
  }

  return { ctx, service, companyId: ctx.companyId }
}

export async function GET() {
  const c = await caller()
  if ("error" in c) return c.error
  const { service, companyId } = c

  // Cast: the generated Supabase types predate the retention columns.
  const { data, error } = (await service
    .from("jobs")
    .select(JOB_FIELDS)
    .eq("company_id", companyId)
    // Archived jobs are deliberately NOT excluded. Retention outlives the job:
    // by the time a claim falls due the work finished a year ago and the job
    // has almost certainly been archived, so filtering them out would hide
    // precisely the money this feature exists to recover.
    .not("retention_percent", "is", null)
    .limit(1000)) as { data: any[] | null; error: any }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const today = londonToday()
  const jobs = (data || [])
    .map((j: any) => ({ job: j, retention: retentionFor(toInput(j), today) }))
    // "none" means the percentage is set but the contract is worth nothing yet,
    // which is a half-filled form rather than a retention record.
    .filter(({ retention }) => retention.state !== "none")
    .map(({ job, retention }) => ({
      id: job.id,
      name: job.name,
      contractor: job.contractor,
      status: job.status,
      contractValue: numberOrNull(job.contract_value),
      retentionPercent: numberOrNull(job.retention_percent),
      practicalCompletionDate: job.practical_completion_date,
      defectsPeriodMonths: job.defects_period_months,
      retentionReleasedAt: job.retention_released_at,
      ...retention,
    }))

  // Soonest claim first, and jobs with no date at the bottom: the list is a
  // queue of what to chase, so it is ordered by when it needs chasing.
  jobs.sort((a, b) => {
    const outA = isOutstanding(a.state as RetentionState)
    const outB = isOutstanding(b.state as RetentionState)
    if (outA !== outB) return outA ? -1 : 1
    if (!a.claimDueDate && !b.claimDueDate) return a.name.localeCompare(b.name)
    if (!a.claimDueDate) return 1
    if (!b.claimDueDate) return -1
    return a.claimDueDate.localeCompare(b.claimDueDate)
  })

  const outstanding = jobs.filter(j => isOutstanding(j.state as RetentionState))

  return NextResponse.json({
    today,
    jobs,
    totals: {
      // Summed from the same per-job figures the rows print, so the total can
      // never disagree with the column above it.
      held: round2(outstanding.reduce((sum, j) => sum + j.amountHeld, 0)),
      jobCount: outstanding.length,
      dueSoon: jobs.filter(j => j.state === "due_soon").length,
      claimable: jobs.filter(j => j.state === "claimable").length,
      released: round2(
        jobs.filter(j => j.state === "released").reduce((sum, j) => sum + j.amountHeld, 0),
      ),
    },
  })
}

export async function PATCH(request: Request) {
  const c = await caller()
  if ("error" in c) return c.error
  const { ctx, service, companyId } = c

  const body = await request.json().catch(() => null)
  if (!body?.jobId) return NextResponse.json({ error: "jobId is required" }, { status: 400 })

  // Scoped read first. Without this a caller could patch another tenant's job
  // by id, because the update below is by primary key.
  const { data: job } = (await service
    .from("jobs").select(JOB_FIELDS).eq("id", body.jobId).eq("company_id", companyId).single()) as { data: any }
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 })

  const update: Record<string, any> = {}

  if ("contractValue" in body) {
    const v = parseMoney(body.contractValue)
    if (v === undefined) return NextResponse.json({ error: "Contract value must be a number" }, { status: 400 })
    update.contract_value = v
  }

  if ("retentionPercent" in body) {
    const v = parseMoney(body.retentionPercent)
    if (v === undefined) return NextResponse.json({ error: "Retention percent must be a number" }, { status: 400 })
    // 0-100 is also a check constraint. Refused here too so the admin gets a
    // sentence rather than a Postgres error: 50 typed for 5.0 is the common
    // slip and it would otherwise hold back half the contract.
    if (v !== null && (v < 0 || v > 100)) {
      return NextResponse.json({ error: "Retention percent must be between 0 and 100" }, { status: 400 })
    }
    update.retention_percent = v
  }

  if ("practicalCompletionDate" in body) {
    const v = parseDate(body.practicalCompletionDate)
    if (v === undefined) return NextResponse.json({ error: "Practical completion must be a date" }, { status: 400 })
    update.practical_completion_date = v
  }

  if ("defectsPeriodMonths" in body) {
    const raw = body.defectsPeriodMonths
    if (raw === null || raw === "") update.defects_period_months = null
    else {
      const v = Number(raw)
      if (!Number.isInteger(v) || v < 0 || v > 120) {
        return NextResponse.json({ error: "Defects period must be a whole number of months, 0 to 120" }, { status: 400 })
      }
      update.defects_period_months = v
    }
  }

  // Release is a separate verb rather than a date field the admin types,
  // because it is the one write here that takes money off the outstanding list
  // and it should carry a name and a timestamp we generated.
  if (body.action === "release") {
    if (job.retention_released_at) {
      return NextResponse.json({ error: "Already released" }, { status: 409 })
    }
    update.retention_released_at = new Date().toISOString()
    update.retention_released_by = ctx.userId
  }

  // Undo, for the misclick. Without it the only way back is the database.
  if (body.action === "unrelease") {
    update.retention_released_at = null
    update.retention_released_by = null
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 })
  }

  const { data: updated, error } = (await service
    .from("jobs")
    .update(update)
    .eq("id", body.jobId)
    .eq("company_id", companyId)
    .select(JOB_FIELDS)
    .single()) as { data: any; error: any }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const today = londonToday()
  return NextResponse.json({
    ok: true,
    job: {
      id: updated.id,
      name: updated.name,
      contractValue: numberOrNull(updated.contract_value),
      retentionPercent: numberOrNull(updated.retention_percent),
      practicalCompletionDate: updated.practical_completion_date,
      defectsPeriodMonths: updated.defects_period_months,
      retentionReleasedAt: updated.retention_released_at,
      ...retentionFor(toInput(updated), today),
    },
  })
}

function toInput(job: any) {
  return {
    contractValue: numberOrNull(job.contract_value),
    retentionPercent: numberOrNull(job.retention_percent),
    practicalCompletionDate: job.practical_completion_date,
    defectsPeriodMonths: job.defects_period_months,
    retentionReleasedAt: job.retention_released_at,
  }
}

/** numeric comes back from postgrest as a string. Keep it a number or null. */
function numberOrNull(value: any): number | null {
  if (value === null || value === undefined || value === "") return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** null clears the field; undefined means the input was not a number at all. */
function parseMoney(raw: any): number | null | undefined {
  if (raw === null || raw === "") return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return undefined
  return n
}

function parseDate(raw: any): string | null | undefined {
  if (raw === null || raw === "") return null
  if (typeof raw !== "string") return undefined
  const date = raw.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined
  if (Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return undefined
  return date
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
