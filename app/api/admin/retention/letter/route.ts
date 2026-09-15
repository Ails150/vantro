// app/api/admin/retention/letter/route.ts
//
// POST { jobId } -> a one-page retention claim letter as a PDF.
//
// One click, because the reason retention goes unclaimed is not that anyone
// decided to let it go. It is that claiming it means finding the contract,
// working out the date, writing a letter and digging out the paperwork, and
// that is four jobs nobody has time for on a Tuesday. All four are already
// answerable from data this product holds.
//
// The letter cites the job's audit pack reference. See lib/retention-letter.ts
// for why it cites rather than attaches.

import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { getCallerContext } from "@/lib/company-context"
import { can, toPlan } from "@/lib/plan"
import { londonToday, retentionFor } from "@/lib/retention"
import { renderRetentionLetterPdf } from "@/lib/retention-letter"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MANAGER_ROLES = ["admin", "superadmin", "support"]

export async function POST(request: Request) {
  const ctx = await getCallerContext()
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!MANAGER_ROLES.includes(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (!ctx.companyId) return NextResponse.json({ error: "No company selected" }, { status: 400 })

  const body = await request.json().catch(() => null)
  if (!body?.jobId) return NextResponse.json({ error: "jobId is required" }, { status: 400 })

  const service = await createServiceClient()

  const { data: company } = (await service
    .from("companies").select("id, name, plan").eq("id", ctx.companyId).single()) as { data: any }
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 })

  if (!can(toPlan(company.plan), "retentionTracking")) {
    return NextResponse.json(
      { error: "Retention tracking is on the Suite plan", requiredPlan: "suite" },
      { status: 402 },
    )
  }

  // Scoped by company as well as by id: the job id comes from the client.
  // Cast: the generated Supabase types predate the retention columns, and
  // without it postgrest widens the row to GenericStringError.
  const { data: job } = (await service
    .from("jobs")
    .select(
      "id, name, address, contractor, contract_value, retention_percent, " +
        "practical_completion_date, defects_period_months, retention_released_at",
    )
    .eq("id", body.jobId)
    .eq("company_id", ctx.companyId)
    .single()) as { data: any }

  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 })

  const today = londonToday()
  const retention = retentionFor(
    {
      contractValue: numberOrNull(job.contract_value),
      retentionPercent: numberOrNull(job.retention_percent),
      practicalCompletionDate: job.practical_completion_date,
      defectsPeriodMonths: job.defects_period_months,
      retentionReleasedAt: job.retention_released_at,
    },
    today,
  )

  // A letter claiming nothing is not a letter. Refused with the reason rather
  // than produced blank, so the admin is told to fill in the terms.
  if (retention.state === "none") {
    return NextResponse.json(
      { error: "This job has no retention recorded. Set a contract value and a retention percentage first." },
      { status: 400 },
    )
  }
  // Released is refused too. Asking a client again for money they have already
  // paid is the single worst thing this feature could do to a customer's
  // relationship with their main contractor.
  if (retention.state === "released") {
    return NextResponse.json(
      { error: "Retention on this job is already marked as released." },
      { status: 409 },
    )
  }

  // The most recent pack for this job. Most recent rather than first: packs are
  // regenerated as a job accumulates evidence, and the letter should cite the
  // one that covers the most work.
  const { data: packs } = (await service
    .from("audit_packs")
    .select("reference, generated_at")
    .eq("company_id", ctx.companyId)
    .eq("job_id", job.id)
    .not("reference", "is", null)
    .order("generated_at", { ascending: false })
    .limit(1)) as { data: any[] | null }

  const packReference = packs?.[0]?.reference || null

  const pdf = await renderRetentionLetterPdf({
    companyName: company.name,
    jobName: job.name,
    contractor: job.contractor,
    jobAddress: job.address,
    contractValue: numberOrNull(job.contract_value),
    retentionPercent: numberOrNull(job.retention_percent),
    amountHeld: retention.amountHeld,
    practicalCompletionDate: job.practical_completion_date,
    defectsPeriodMonths: job.defects_period_months,
    claimDueDate: retention.claimDueDate,
    evidencePackReference: packReference,
    verifyUrl: packReference ? "https://getvantro.com/verify" : null,
    issuedOn: today,
  })

  console.log(
    `[retention] claim letter job=${job.id} company=${company.id} ` +
      `amount=${retention.amountHeld} state=${retention.state} pack=${packReference ?? "none"}`,
  )

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      // inline, not attachment: the admin wants to read it before it goes to a
      // client, and a letter that lands in the downloads folder unseen is one
      // that gets sent with the wrong figure on it.
      "Content-Disposition": `inline; filename="${filename(company.name, job.name, today)}"`,
      "Cache-Control": "no-store",
    },
  })
}

function numberOrNull(value: any): number | null {
  if (value === null || value === undefined || value === "") return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function filename(companyName: string, jobName: string, today: string): string {
  const slug = (s: string) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 40)
  return `retention-claim-${slug(companyName)}-${slug(jobName)}-${today}.pdf`
}
