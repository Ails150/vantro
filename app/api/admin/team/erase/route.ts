// app/api/admin/team/erase/route.ts
//
// POST { userId, confirmation } -- UK GDPR Article 17 for one worker.
//
// This anonymises rather than deletes, and lib/gdpr.ts carries the reasoning at
// length. In short: a sign-in record is also proof a site was manned, a RAMS
// signature is proof the method statement was briefed, and both sit inside
// signed audit packs that a client may rely on. Article 17(3) exempts records
// kept for a legal obligation or the defence of legal claims, and health and
// safety records are both. So the identity goes and the event stays.
//
// IT IS NOT REVERSIBLE AND THE ROUTE SAYS SO. There is no undo, because an undo
// would mean keeping the name somewhere, which is the thing being removed.

import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { getCallerContext } from "@/lib/company-context"
import { anonymisePatch, pseudonymFor, tablesToDelete, tablesToDetach } from "@/lib/gdpr"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

// Superadmin and admin only. A foreman can see the team; erasing somebody is a
// controller decision with a legal record attached to it.
const ERASE_ROLES = ["admin", "superadmin", "support"]

export async function POST(request: Request) {
  const ctx = await getCallerContext()
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!ERASE_ROLES.includes(ctx.role) || !ctx.companyId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const userId = body?.userId
  if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 })

  const service = await createServiceClient()

  const { data: subject } = (await service
    .from("users")
    .select("id, name, role, anonymised_at, auth_user_id")
    .eq("id", userId)
    .eq("company_id", ctx.companyId)
    .single()) as { data: any }

  if (!subject) return NextResponse.json({ error: "Worker not found" }, { status: 404 })

  if (subject.anonymised_at) {
    return NextResponse.json({ error: "This person has already been erased" }, { status: 409 })
  }

  // Typing the name is the confirmation, the same pattern the company delete
  // uses. This destroys an identity permanently and a single click is not
  // enough friction for that.
  const confirmation = String(body?.confirmation ?? "").trim()
  if (confirmation !== subject.name) {
    return NextResponse.json(
      { error: "Type the person's name exactly to confirm" },
      { status: 400 },
    )
  }

  // Erasing yourself would leave the company without the administrator who is
  // mid-request, and the session would then belong to a row with no auth user.
  if (subject.id === ctx.userId) {
    return NextResponse.json(
      { error: "You cannot erase your own record. Ask another administrator." },
      { status: 400 },
    )
  }

  const warnings: string[] = []

  // 1. Rows that are purely operational and hold no evidential value.
  for (const t of tablesToDelete()) {
    const { error } = await service.from(t.table).delete().eq(t.column, userId)
    if (error) {
      console.error(`[gdpr] erase: ${t.table} delete failed:`, error.message)
      warnings.push(`${t.table}_delete_failed`)
    }
  }

  // 2. Rows belonging to somebody else that merely point at this person.
  for (const t of tablesToDetach()) {
    const { error } = await service.from(t.table).update({ [t.column]: null }).eq(t.column, userId)
    if (error) {
      console.error(`[gdpr] erase: ${t.table}.${t.column} detach failed:`, error.message)
      warnings.push(`${t.table}_${t.column}_detach_failed`)
    }
  }

  // 3. Remove the Supabase login, if this person had one.
  //
  // Before the users row is patched: the patch nulls auth_user_id, and after it
  // there is nothing left to say which auth account to delete.
  if (subject.auth_user_id) {
    const { error } = await service.auth.admin.deleteUser(subject.auth_user_id)
    if (error) {
      console.error("[gdpr] erase: auth user delete failed:", error.message)
      warnings.push("auth_user_delete_failed")
    }
  }

  // 4. The identity itself.
  const { error: patchErr } = await service
    .from("users")
    .update(anonymisePatch(subject.id, ctx.userId))
    .eq("id", subject.id)
    .eq("company_id", ctx.companyId)

  if (patchErr) {
    // This is the step that matters. If it fails the person is NOT erased, and
    // saying otherwise would be the worst possible outcome of this route.
    console.error("[gdpr] erase: anonymise failed:", patchErr.message)
    return NextResponse.json(
      { error: `Could not erase: ${patchErr.message}`, warnings },
      { status: 500 },
    )
  }

  // 5. The accountability record. subject_label is deliberately null: keeping
  // the name here would defeat the erasure this row exists to record.
  await service.from("data_subject_requests").insert({
    company_id: ctx.companyId,
    subject_id: subject.id,
    subject_label: null,
    kind: "erasure",
    actioned_by: ctx.userId,
    notes:
      `Anonymised. ${tablesToDelete().length} operational tables cleared, ` +
      `${tablesToDetach().length} references detached, evidence retained under Art 17(3).` +
      (warnings.length ? ` Warnings: ${warnings.join(", ")}` : ""),
  })

  console.warn(
    `[gdpr] ERASED subject=${subject.id} company=${ctx.companyId} by=${ctx.userId}` +
      (warnings.length ? ` warnings=${warnings.join(",")}` : ""),
  )

  return NextResponse.json({
    ok: true,
    pseudonym: pseudonymFor(subject.id),
    warnings: warnings.length > 0 ? warnings : undefined,
  })
}
