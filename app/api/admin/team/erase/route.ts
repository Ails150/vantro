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
import { clearSnapshotsForWorker } from "@/lib/payroll-timesheet"

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

  // ORDER MATTERS. Everything that can be retried comes first and nothing
  // irreversible happens until the identity is gone. This used to delete rows
  // and the login BEFORE anonymising, and the anonymise step always failed (it
  // wrote a phone column users does not have), so every erasure ever attempted
  // half-ran and then reported failure. None had ever succeeded.

  // 1. The frozen Xero timesheets. An approved week keeps its timesheet as a
  // CSV holding names and emails, so anonymising the users row alone would
  // leave this person in every approved week they worked. If this fails,
  // nothing has been changed yet and the request can simply be run again.
  let xeroWeeksCleared = 0
  try {
    xeroWeeksCleared = await clearSnapshotsForWorker(service, ctx.companyId, subject.id)
  } catch (e: any) {
    console.error("[gdpr] erase: clearing Xero snapshots failed:", e?.message)
    return NextResponse.json(
      { error: "Could not erase: their name is still in an approved week's Xero file. Nothing was changed; try again." },
      { status: 500 },
    )
  }

  // 2. The identity itself. This is the step that matters: if it fails the
  // person is NOT erased, and nothing after it has run. It also unlinks the
  // login, whose id was read above and is deleted in step 5.
  const { error: patchErr } = await service
    .from("users")
    .update(anonymisePatch(subject.id, ctx.userId))
    .eq("id", subject.id)
    .eq("company_id", ctx.companyId)

  if (patchErr) {
    console.error("[gdpr] erase: anonymise failed:", patchErr.message)
    return NextResponse.json(
      { error: `Could not erase: ${patchErr.message}` },
      { status: 500 },
    )
  }

  // 3. Rows that are purely operational and hold no evidential value.
  for (const t of tablesToDelete()) {
    const { error } = await service.from(t.table).delete().eq(t.column, userId)
    if (error) {
      console.error(`[gdpr] erase: ${t.table} delete failed:`, error.message)
      warnings.push(`${t.table}_delete_failed`)
    }
  }

  // 4. Rows belonging to somebody else that merely point at this person.
  for (const t of tablesToDetach()) {
    const { error } = await service.from(t.table).update({ [t.column]: null }).eq(t.column, userId)
    if (error) {
      console.error(`[gdpr] erase: ${t.table}.${t.column} detach failed:`, error.message)
      warnings.push(`${t.table}_${t.column}_detach_failed`)
    }
  }

  // 5. Remove the Supabase login, if this person had one. After the users row
  // has let go of it: deleting it first failed while the row still pointed at it.
  if (subject.auth_user_id) {
    const { error } = await service.auth.admin.deleteUser(subject.auth_user_id)
    if (error) {
      console.error("[gdpr] erase: auth user delete failed:", error.message)
      warnings.push("auth_user_delete_failed")
    }
  }

  // 6. The accountability record. subject_label is deliberately null: keeping
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
    xeroWeeksCleared,
    warnings: warnings.length > 0 ? warnings : undefined,
  })
}
