import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"
import { acceptanceColumns } from "@/lib/legal"

/**
 * Accept the terms and the DPA from inside the product.
 *
 * Signup now captures this with a checkbox, so for anything created after that
 * this route is a no-op nobody reaches. It stays for the two cases that are not
 * going away:
 *
 *  - Companies that existed before there was a checkbox. They were deliberately
 *    not backfilled -- a consent record invented by a migration is worse than
 *    no record, because it looks like evidence -- so they have a gap, and this
 *    is how an admin closes it.
 *  - A reissued document. When the version is bumped, every company's
 *    acceptance becomes outdated and has to be given again.
 *
 * It stamps both documents, the same as signup, because the compliance panel
 * offers them together and accepting one while leaving the other outdated is a
 * state nobody asked for.
 */
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const service = await createServiceClient()
  const { data: u } = await service.from("users").select("id, name, role, company_id").eq("auth_user_id", user.id).single()
  if (!u) return NextResponse.json({ error: "User not found" }, { status: 404 })

  if (!["admin", "superadmin"].includes(u.role)) {
    return NextResponse.json({ error: "Only an admin can accept the DPA" }, { status: 403 })
  }

  const { error } = await service.from("companies").update({
    // The version strings used to be typed in here as "1.0". They come from
    // lib/legal.ts now, so bumping a document updates the route, the signup
    // page and whatever reads the state back, rather than three of the four.
    ...acceptanceColumns(u.name || "Admin"),
    dpa_accepted_by_user_id: u.id,
  }).eq("id", u.company_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
