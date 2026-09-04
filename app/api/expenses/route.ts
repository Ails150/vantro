import { NextResponse } from "next/server"
import crypto from "crypto"
import { createServiceClient } from "@/lib/supabase/server"
import { verifyFieldToken } from "@/lib/auth"
import { uploadReceipt } from "@/lib/expense-upload"
import { assertJobBelongsToCaller } from "@/lib/tenant"
import { recordFileHash } from "@/lib/evidence"

/**
 * POST /api/expenses
 *   Multipart form-data:
 *     - receipt (File, required)
 *     - amount (string, required)
 *     - category (string, required: fuel|materials|food|parking|tools|other)
 *     - vat_amount (string, optional)
 *     - job_id (string, optional)
 *     - note (string, optional)
 *
 * GET /api/expenses?weekStart=YYYY-MM-DD
 *   Returns installer's own expenses for the week (or current week if omitted)
 */

const ALLOWED_CATEGORIES = new Set(["fuel", "materials", "food", "parking", "tools", "other"])

export async function POST(request: Request) {
  try {
    const installer = verifyFieldToken(request)
    if (!installer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const form = await request.formData()
    const file = form.get("receipt") as File | null
    const amountRaw = form.get("amount") as string | null
    const categoryRaw = (form.get("category") as string | null) || "other"
    const vatRaw = form.get("vat_amount") as string | null
    const jobId = form.get("job_id") as string | null
    const note = form.get("note") as string | null

    if (!file) return NextResponse.json({ error: "Receipt photo required" }, { status: 400 })
    if (!amountRaw) return NextResponse.json({ error: "Amount required" }, { status: 400 })

    const amount = parseFloat(amountRaw)
    if (isNaN(amount) || amount <= 0) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 })
    }
    if (amount > 99999.99) {
      return NextResponse.json({ error: "Amount too large" }, { status: 400 })
    }

    const category = categoryRaw.toLowerCase()
    if (!ALLOWED_CATEGORIES.has(category)) {
      return NextResponse.json({ error: "Invalid category" }, { status: 400 })
    }

    const vatAmount = vatRaw ? parseFloat(vatRaw) : null
    if (vatAmount !== null && (isNaN(vatAmount) || vatAmount < 0)) {
      return NextResponse.json({ error: "Invalid VAT amount" }, { status: 400 })
    }

    // job_id is supplied by the client. The expense row itself is stamped with
    // the caller's company, so an unchecked id could not leak another tenant's
    // data, but it would attach the claim to their job and surface that job's
    // name back through the admin view.
    if (jobId) {
      const owned = await assertJobBelongsToCaller(jobId, installer.companyId)
      if (!owned.ok) return owned.response
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer())

    // Idempotency: the same receipt image, for the same amount, on the same
    // job is the same expense. A double tap or a retry after a flaky upload
    // used to land as two rows (the demo tenant showed one £859.14 Materials
    // at 08:33 and again at 08:48). Scoped to the user so two people
    // photographing one receipt still each get their own claim.
    const receiptHash = crypto.createHash("sha256").update(fileBuffer).digest("hex")
    const idempotencyKey = [
      installer.userId,
      receiptHash,
      amount.toFixed(2),
      jobId || "no-job",
    ].join(":")

    const service = await createServiceClient()

    const { data: duplicate } = await service
      .from("expenses")
      .select("id, amount, vat_amount, category, note, receipt_url, status, submitted_at, paid_at, job_id, review_note")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle()

    if (duplicate) {
      console.log("[expenses] Duplicate rejected:", idempotencyKey, "existing", duplicate.id)
      return NextResponse.json({ success: true, duplicate: true, expense: duplicate })
    }

    // Upload to R2 only once we know this is a new receipt.
    const uploaded = await uploadReceipt({
      companyId: installer.companyId,
      userId: installer.userId,
      fileBuffer,
      mimeType: file.type || "image/jpeg",
      fileName: file.name,
    })

    // Phase 1.1: the receipt bytes were already hashed above, for idempotency.
    // Record that same hash as evidence, keyed by the R2 object key, so a
    // reader can check the archived image against what was submitted rather
    // than trusting the URL. Expenses is the one place a file hash already
    // existed; it was just never kept.
    await recordFileHash({
      companyId: installer.companyId,
      storagePath: uploaded.key,
      sha256: receiptHash,
      hashedBy: installer.userId,
    })

    const row: any = {
      company_id: installer.companyId,
      user_id: installer.userId,
      job_id: jobId || null,
      amount,
      vat_amount: vatAmount,
      category,
      note: note || null,
      receipt_url: uploaded.publicUrl,
      receipt_mime: file.type || "image/jpeg",
      idempotency_key: idempotencyKey,
    }

    let { data, error } = await service.from("expenses").insert(row).select().single()

    // Two submissions can race past the read above; the partial unique index
    // is the real guard, so treat its violation as the duplicate it is.
    if (error && (error.code === "23505" || /idempotency_key/.test(error.message || ""))) {
      const { data: existing } = await service
        .from("expenses")
        .select("id, amount, vat_amount, category, note, receipt_url, status, submitted_at, paid_at, job_id, review_note")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle()
      if (existing) {
        console.log("[expenses] Duplicate rejected on insert:", idempotencyKey, "existing", existing.id)
        return NextResponse.json({ success: true, duplicate: true, expense: existing })
      }
      // Column not migrated yet - save the expense rather than lose it.
      delete row.idempotency_key
      ;({ data, error } = await service.from("expenses").insert(row).select().single())
    }

    if (error) {
      console.error("[expenses] Insert failed:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    console.log("[expenses] Submitted:", data.id, "by", installer.userId, "amount", amount, "category", category)
    return NextResponse.json({ success: true, expense: data })

  } catch (e: any) {
    console.error("[expenses POST] Error:", e)
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 })
  }
}

export async function GET(request: Request) {
  try {
    const installer = verifyFieldToken(request)
    if (!installer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const weekStart = searchParams.get("weekStart")

    const service = await createServiceClient()
    let query = service
      .from("expenses")
      .select("id, amount, vat_amount, category, note, receipt_url, status, submitted_at, paid_at, job_id, review_note")
      .eq("user_id", installer.userId)
      .order("submitted_at", { ascending: false })
      .limit(100)

    if (weekStart) {
      const weekStartDate = new Date(weekStart)
      const weekEndDate = new Date(weekStartDate)
      weekEndDate.setDate(weekEndDate.getDate() + 7)
      query = query
        .gte("submitted_at", weekStartDate.toISOString())
        .lt("submitted_at", weekEndDate.toISOString())
    }

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ expenses: data || [] })

  } catch (e: any) {
    console.error("[expenses GET] Error:", e)
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 })
  }
}
