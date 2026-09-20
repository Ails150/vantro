// lib/setup-complete.ts
//
// Setup is finished by doing the thing, not by confirming that you did it.
//
// The requirement to leave setup is one job. Once that job exists there is
// nothing left for a "Go to dashboard" button to decide, and a confirmation
// whose only possible answer is yes is a tax on somebody who has already done
// the work -- especially here, where the button lives on a screen they were
// redirected to rather than one they chose.
//
// So the routes that can satisfy the requirement stamp it themselves. The
// wizard keeps its button as the manual way out: a first run must never be
// able to strand somebody on a screen that is trying and failing to leave.

export async function maybeCompleteSetup(service: any, companyId: string): Promise<boolean> {
  try {
    const { data: company } = await service
      .from("companies").select("onboarding_completed_at").eq("id", companyId).maybeSingle()
    if (!company || company.onboarding_completed_at) return false

    const { count } = await service
      .from("jobs").select("id", { count: "exact", head: true }).eq("company_id", companyId)
    if (!count) return false

    const { error } = await service
      .from("companies")
      .update({ onboarding_completed_at: new Date().toISOString() })
      .eq("id", companyId)
      .is("onboarding_completed_at", null)
    if (error) {
      console.error("[setup] could not self-complete:", error.message)
      return false
    }
    console.log(`[setup] company=${companyId} completed itself on its first job`)
    return true
  } catch (e: any) {
    // Never fails the caller: the job or the PIN they asked for is already
    // saved, and a stamp that did not happen costs one extra screen.
    console.error("[setup] self-complete threw:", e?.message || e)
    return false
  }
}
