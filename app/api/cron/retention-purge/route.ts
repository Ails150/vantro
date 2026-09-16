// app/api/cron/retention-purge/route.ts
//
// Nightly. Deletes records older than each company's chosen retention policy.
//
// This is the job that makes the setting real. Before it, data_retention_days
// was read by one weekly route that deleted GPS breadcrumbs and nothing else,
// so a company could choose "3 years" and keep every shift for ever.
//
// THREE THINGS IT WILL NOT DO, each for its own reason:
//
//   It will not touch a company inside its thirty day grace. See
//   lib/retention-policy.ts -- choosing a policy on a company with more history
//   than the policy allows would otherwise destroy years of records the same
//   night, before anybody had seen the banner.
//
//   It will not touch a FREE company. Free retention is five days and is
//   already enforced by /api/cron/free-retention against lib/plan.ts. Two jobs
//   deleting the same rows on different schedules is how a deletion bug becomes
//   impossible to attribute.
//
//   It will not touch the integrity chain. audit_packs and evidence_hashes are
//   excluded from PURGE_TABLES: a pack issued to a client must stay verifiable
//   for as long as the client holds it, and its hashes are what make it so. A
//   retention policy is about records, not about withdrawing a document
//   somebody has already been given.
//
// IT RECORDS WHAT IT DESTROYED. retention_purges is the only account that
// survives a purge, because the rows themselves are gone.

import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { authoriseCron } from "@/lib/cron-auth"
import { toPlan } from "@/lib/plan"
import { PURGE_TABLES, retentionState } from "@/lib/retention-policy"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function GET(request: Request) {
  if (!authoriseCron(request).ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(request.url)
  // ?dryRun=1 reports what WOULD go without deleting anything. The first thing
  // anybody sensible does before turning this loose on a real tenant.
  const dryRun = url.searchParams.get("dryRun") === "1"

  const service = await createServiceClient()
  const now = new Date()

  const { data: companies, error } = await service
    .from("companies")
    .select("id, name, plan, data_retention_days, retention_policy_set_at")
    .not("data_retention_days", "is", null)

  if (error) {
    console.error("[retention-purge] could not list companies:", error.message)
    return NextResponse.json({ error: "Could not list companies" }, { status: 500 })
  }

  const ran: any[] = []
  const skipped: Array<{ company: string; why: string }> = []

  for (const company of (companies || []) as any[]) {
    // Free is governed by lib/plan.ts and swept by a different job.
    if (toPlan(company.plan) === "free") {
      skipped.push({ company: company.name, why: "free plan, swept by free-retention" })
      continue
    }

    const state = retentionState(
      company.data_retention_days,
      company.retention_policy_set_at,
      now,
    )

    if (!state.active || !state.cutoff) {
      skipped.push({
        company: company.name,
        why: state.firstPurgeAt
          ? `in grace until ${state.firstPurgeAt.toISOString().slice(0, 10)}`
          : "policy has no set-at timestamp",
      })
      continue
    }

    const cutoff = state.cutoff.toISOString()
    const deleted: Record<string, number> = {}
    let total = 0
    const failures: string[] = []

    for (const { table, column } of PURGE_TABLES) {
      try {
        if (dryRun) {
          const { count } = await service
            .from(table)
            .select("id", { count: "exact", head: true })
            .eq("company_id", company.id)
            .lt(column, cutoff)
          if (count) { deleted[table] = count; total += count }
          continue
        }

        const { count, error: delErr } = await service
          .from(table)
          .delete({ count: "exact" })
          .eq("company_id", company.id)
          .lt(column, cutoff)

        if (delErr) {
          // One table failing must not abandon the rest. A partial purge is
          // recorded as a partial purge rather than reported as a clean one.
          console.error(`[retention-purge] ${company.id}/${table}: ${delErr.message}`)
          failures.push(table)
          continue
        }
        if (count) { deleted[table] = count; total += count }
      } catch (err: any) {
        console.error(`[retention-purge] ${company.id}/${table} threw:`, err?.message || err)
        failures.push(table)
      }
    }

    if (!dryRun && total > 0) {
      // Written AFTER the deletes, because it records what actually went. A row
      // written first and then contradicted by a failure would be worse than no
      // row at all.
      const { error: logErr } = await service.from("retention_purges").insert({
        company_id: company.id,
        retention_days: state.retentionDays,
        cutoff,
        deleted: failures.length ? { ...deleted, _failed: failures } : deleted,
        total_deleted: total,
      })
      if (logErr) {
        console.error(`[retention-purge] could not log purge for ${company.id}:`, logErr.message)
      }
    }

    ran.push({
      company: company.name,
      companyId: company.id,
      retentionDays: state.retentionDays,
      cutoff,
      total,
      deleted,
      failures: failures.length ? failures : undefined,
    })

    console.log(
      `[retention-purge]${dryRun ? " DRY RUN" : ""} company=${company.id} ` +
        `days=${state.retentionDays} cutoff=${cutoff.slice(0, 10)} deleted=${total}` +
        (failures.length ? ` failed=${failures.join(",")}` : ""),
    )
  }

  return NextResponse.json({ ok: true, dryRun, ran, skipped })
}
