// app/api/cron/free-retention/route.ts
//
// Nightly. Deletes shift rows older than the free plan's retention window.
//
// lib/plan.ts has promised this since the plans were written: "Free is
// deliberately short and is enforced by a nightly job that deletes older rows,
// not merely hidden in the UI". The job did not exist, so free companies kept
// everything for ever while the Billing tab and the Today board both told them
// otherwise. Three things were wrong with that at once -- the retention line
// was a lie, the paid plans' "history kept for good" was not a difference, and
// we were storing records nobody pays to store.
//
// Deletion is by plan, read from lib/plan.ts, so a company that upgrades stops
// being swept the same night and one that cancels starts being swept again.
// A plan whose historyDays is null is never touched.
//
// Auth: Vercel cron sends Authorization: Bearer <CRON_SECRET>.

import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { HISTORY_DAYS, toPlan, type Plan } from "@/lib/plan"
import { authoriseCron } from "@/lib/cron-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(request: Request) {
  const cron = authoriseCron(request)
  if (!cron.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const service = await createServiceClient()

  // Only the plans that actually expire. Today that is free alone, but reading
  // it from the table means adding a retained plan later needs no change here.
  const expiring = (Object.keys(HISTORY_DAYS) as Plan[]).filter(
    (p) => HISTORY_DAYS[p] !== null,
  )

  const { data: companies, error: readErr } = await service
    .from("companies")
    .select("id, name, plan")
    .in("plan", expiring)

  if (readErr) {
    console.error("[free-retention] could not list companies:", readErr)
    return NextResponse.json({ error: "Could not list companies" }, { status: 500 })
  }

  const results: Array<{ company: string; plan: Plan; cutoff: string; deleted: number }> = []
  let totalDeleted = 0

  for (const company of companies || []) {
    const plan = toPlan(company.plan)
    const days = HISTORY_DAYS[plan]
    if (days === null) continue

    const cutoff = new Date(Date.now() - days * 86400000).toISOString()

    // Deleted, not archived. "We still have your data but will not show it to
    // you" is a worse offer than a stated window, and it leaves us holding
    // records nobody is paying to store.
    const { data: deleted, error: delErr } = await service
      .from("signins")
      .delete()
      .eq("company_id", company.id)
      .lt("signed_in_at", cutoff)
      .select("id")

    if (delErr) {
      // One company's failure must not stop the sweep for the rest.
      console.error(`[free-retention] delete failed for ${company.id}:`, delErr)
      continue
    }

    const count = deleted?.length || 0
    totalDeleted += count
    if (count > 0) {
      results.push({ company: company.name, plan, cutoff, deleted: count })
    }
  }

  console.log(
    `[free-retention] swept ${companies?.length || 0} companies, deleted ${totalDeleted} shift rows`,
  )

  return NextResponse.json({
    ok: true,
    companiesChecked: companies?.length || 0,
    totalDeleted,
    // Only the companies something actually happened to, so the log is
    // readable when a hundred free accounts have nothing to delete.
    results,
  })
}
