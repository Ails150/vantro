import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { verifyInstallerToken } from "@/lib/auth"
import { uploadReceipt } from "@/lib/expense-upload"

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
    const installer = verifyInstallerToken(request)
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

    // Upload to R2
    const fileBuffer = Buffer.from(await file.arrayBuffer())
    const uploaded = await uploadReceipt({
      companyId: installer.companyId,
      userId: installer.userId,
      fileBuffer,
      mimeType: file.type || "image/jpeg",
      fileName: file.name,
    })

    // Insert DB row
    const service = await createServiceClient()
    const { data, error } = await service.from("expenses").insert({
      company_id: installer.companyId,
      user_id: installer.userId,
      job_id: jobId || null,
      amount,
      vat_amount: vatAmount,
      category,
      note: note || null,
      receipt_url: uploaded.publicUrl,
      receipt_mime: file.type || "image/jpeg",
    }).select().single()

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
    const installer = verifyInstallerToken(request)
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
