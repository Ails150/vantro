// lib/suite-caller.ts
//
// "Is this a manager of a company on a plan that includes this feature?"
//
// The retention route answers this inline. Variations and payment applications
// need the same answer in five route files, and five copies of a role list and
// a plan check is how one of them ends up missing the plan check.

import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { getCallerContext, OWNER_ROLES, type CallerContext } from "@/lib/company-context"
import { can, requiredPlan, toPlan, type Feature } from "@/lib/plan"

export type SuiteCaller =
  | { error: NextResponse }
  | { ctx: CallerContext; service: any; companyId: string; company: { id: string; name: string; plan: string } }

export async function suiteCaller(feature: Feature): Promise<SuiteCaller> {
  const ctx = await getCallerContext()
  if (!ctx) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  // Money: owners only. A foreman can see the site; pricing work to a main
  // contractor is the company's decision.
  if (!(OWNER_ROLES as readonly string[]).includes(ctx.role)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }
  if (!ctx.companyId) {
    return { error: NextResponse.json({ error: "No company selected" }, { status: 400 }) }
  }

  const service = await createServiceClient()
  const { data: company } = (await service
    .from("companies").select("id, name, plan").eq("id", ctx.companyId).single()) as { data: any }

  // Checked here as well as hidden in the nav: a hidden tab is a suggestion,
  // and this endpoint is reachable directly.
  if (!company || !can(toPlan(company.plan), feature)) {
    return {
      error: NextResponse.json(
        { error: "This is on the Suite plan", requiredPlan: requiredPlan(feature) },
        { status: 402 },
      ),
    }
  }

  return { ctx, service, companyId: ctx.companyId, company }
}
