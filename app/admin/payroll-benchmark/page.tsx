import { notFound } from "next/navigation"
import PayrollBenchmarkView from "@/components/admin/PayrollBenchmarkView"
import { getCallerContext } from "@/lib/company-context"
import { benchmark, canSeeBenchmark } from "@/lib/payroll-runs"
import { createServiceClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

// A 404, not a 403: nobody else needs to learn that this page exists.
export default async function PayrollBenchmarkPage() {
  const ctx = await getCallerContext()
  if (!ctx?.companyId) notFound()

  const service = await createServiceClient()
  const { data: own } = await service.from("companies").select("name").eq("id", ctx.companyId).single()
  if (!canSeeBenchmark(ctx.role, own?.name)) notFound()

  const [{ data: companies }, { data: runs }] = await Promise.all([
    service.from("companies").select("id, name").limit(10000),
    service.from("payroll_runs")
      .select("company_id, minutes_taken, workers_count, approved_at")
      .not("approved_at", "is", null)
      .limit(100000),
  ])

  return <PayrollBenchmarkView data={benchmark(companies || [], runs || [])} />
}
