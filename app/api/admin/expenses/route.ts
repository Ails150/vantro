import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"
import { getReceiptSignedUrl, extractKeyFromReceiptUrl } from "@/lib/expense-upload"

/**
 * GET /api/admin/expenses?weekStart=YYYY-MM-DD
 *   Returns all expenses on the admin's company, grouped by installer,
 *   for the given week. Receipt URLs are signed (1h expiry).
 *
 * PATCH /api/admin/expenses
 *   Body: { expenseId, status, reviewNote? }
 *   Update status: approved | rejected | queried | paid
 */

async function getCallingAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const service = await createServiceClient()
  const { data: row } = await service
    .from("users")
    .select("id, company_id, role")
    .eq("auth_user_id", user.id)
    .single()
  if (!row) return null
  if (!["admin", "foreman", "superadmin"].includes(row.role)) return null
  return row
}

export async function GET(request: Request) {
  const admin = await getCallingAdmin()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const weekStart = searchParams.get("weekStart")
  if (!weekStart) return NextResponse.json({ error: "weekStart required" }, { status: 400 })

  const weekStartDate = new Date(weekStart)
  const weekEndDate = new Date(weekStartDate)
  weekEndDate.setDate(weekEndDate.getDate() + 7)

  const service = await createServiceClient()
  const { data: expenses, error } = await service
    .from("expenses")
    .select(`
      id, amount, vat_amount, category, note, receipt_url, receipt_mime,
      status, submitted_at, reviewed_at, review_note, paid_at, job_id, user_id
    `)
    .eq("company_id", admin.company_id)
    .gte("submitted_at", weekStartDate.toISOString())
    .lt("submitted_at", weekEndDate.toISOString())
    .order("submitted_at", { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Hydrate user names + job names
  const userIds = Array.from(new Set((expenses || []).map((e: any) => e.user_id)))
  const jobIds = Array.from(new Set((expenses || []).map((e: any) => e.job_id).filter(Boolean)))

  const [{ data: users }, { data: jobs }] = await Promise.all([
    userIds.length > 0
      ? service.from("users").select("id, name").in("id", userIds)
      : Promise.resolve({ data: [] }),
    jobIds.length > 0
      ? service.from("jobs").select("id, name").in("id", jobIds)
      : Promise.resolve({ data: [] }),
  ])

  const userMap = new Map((users || []).map((u: any) => [u.id, u.name]))
  const jobMap = new Map((jobs || []).map((j: any) => [j.id, j.name]))

  // Generate signed URLs for each receipt (parallel)
  const hydrated = await Promise.all(
    (expenses || []).map(async (e: any) => {
      let signedUrl: string | null = null
      try {
        const key = extractKeyFromReceiptUrl(e.receipt_url)
        signedUrl = await getReceiptSignedUrl(key, 3600)
      } catch (err) {
        console.error("[admin/expenses] signed URL failed for", e.id, err)
      }
      return {
        ...e,
        user_name: userMap.get(e.user_id) || "Unknown",
        job_name: e.job_id ? (jobMap.get(e.job_id) || null) : null,
        receipt_signed_url: signedUrl,
      }
    })
  )

  return NextResponse.json({ expenses: hydrated })
}

export async function PATCH(request: Request) {
  const admin = await getCallingAdmin()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const { expenseId, status, reviewNote } = body

  if (!expenseId || !status) {
    return NextResponse.json({ error: "expenseId and status required" }, { status: 400 })
  }
  if (!["approved", "rejected", "queried", "paid"].includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 })
  }

  const service = await createServiceClient()
  const { data: existing } = await service
    .from("expenses")
    .select("id, company_id")
    .eq("id", expenseId)
    .single()

  if (!existing || existing.company_id !== admin.company_id) {
    return NextResponse.json({ error: "Expense not in your company" }, { status: 403 })
  }

  const update: any = {
    status,
    reviewed_at: new Date().toISOString(),
    reviewed_by: admin.id,
    review_note: reviewNote || null,
  }
  if (status === "paid") {
    update.paid_at = new Date().toISOString()
  }

  const { error } = await service.from("expenses").update(update).eq("id", expenseId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
