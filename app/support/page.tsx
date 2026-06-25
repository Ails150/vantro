import { redirect } from "next/navigation"
import { createServiceClient } from "@/lib/supabase/server"
import { getCallerContext } from "@/lib/company-context"
import SupportCompanyPicker from "@/components/support/SupportCompanyPicker"

export const dynamic = "force-dynamic"
export const revalidate = 0

// Platform support landing page: pick a company to view its dashboard.
export default async function SupportPage() {
  const ctx = await getCallerContext()
  if (!ctx) redirect("/login")
  if (!ctx.isSupport) redirect("/admin")

  const service = await createServiceClient()
  const { data: companies } = await service
    .from("companies")
    .select("id, name")
    .order("name")

  return <SupportCompanyPicker companies={companies || []} />
}
