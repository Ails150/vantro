// app/api/admin/team/export/route.ts
//
// GET ?userId=...&format=json|pdf
//
// UK GDPR Article 15: a copy of everything held about one worker.
//
// TWO FORMATS BECAUSE THEY ANSWER TWO DIFFERENT DEMANDS. A subject access
// request is usually satisfied with something a person can read, which is the
// PDF. A worker moving to another employer, or a solicitor, wants the data
// itself, which is the JSON. Offering only the PDF would be technically
// answering while practically withholding.
//
// The section list comes from lib/gdpr.ts, shared with erasure, so the two can
// never disagree about what "their data" means -- an export that covers less
// than the erasure would be the more dangerous mismatch, since it would tell a
// person they had seen everything before it was destroyed.

import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { getCallerContext } from "@/lib/company-context"
import { SUBJECT_TABLES, ERASURE_CAVEATS } from "@/lib/gdpr"
import { renderSubjectExportPdf } from "@/lib/gdpr-export-pdf"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

const EXPORT_ROLES = ["admin", "superadmin", "support"]

export async function GET(request: Request) {
  const ctx = await getCallerContext()
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!EXPORT_ROLES.includes(ctx.role) || !ctx.companyId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const url = new URL(request.url)
  const userId = url.searchParams.get("userId")
  const format = url.searchParams.get("format") === "pdf" ? "pdf" : "json"
  if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 })

  const service = await createServiceClient()

  // Scoped by company. The id comes from the client, and one company's admin
  // must never be able to export another company's worker by guessing a uuid.
  const { data: subject } = (await service
    .from("users")
    .select("id, name, email, phone, role, initials, is_active, created_at, anonymised_at, trades, working_days, sign_in_time, sign_out_time, hourly_rate")
    .eq("id", userId)
    .eq("company_id", ctx.companyId)
    .single()) as { data: any }

  if (!subject) return NextResponse.json({ error: "Worker not found" }, { status: 404 })

  const { data: company } = (await service
    .from("companies").select("id, name").eq("id", ctx.companyId).single()) as { data: any }

  // Each section is fetched independently and a failure is recorded rather than
  // thrown. A subject access request that returns nothing because one table was
  // renamed is worse than one that returns everything else and says which part
  // is missing -- and there is a statutory clock running on it.
  const sections: Array<{ label: string; table: string; column: string; rows: any[]; error?: string }> = []

  for (const t of SUBJECT_TABLES) {
    try {
      const { data, error } = await service
        .from(t.table)
        .select("*")
        .eq(t.column, userId)
        .limit(10000)

      if (error) {
        sections.push({ label: t.label, table: t.table, column: t.column, rows: [], error: error.message })
        continue
      }
      sections.push({ label: t.label, table: t.table, column: t.column, rows: data ?? [] })
    } catch (err: any) {
      sections.push({
        label: t.label, table: t.table, column: t.column, rows: [],
        error: err?.message || "read failed",
      })
    }
  }

  const generatedAt = new Date().toISOString()

  // Logged as an Article 30 record. Done before the response is built so a
  // failure to render the PDF still leaves evidence the request was answered.
  await service.from("data_subject_requests").insert({
    company_id: ctx.companyId,
    subject_id: subject.id,
    // Kept for an export, unlike an erasure, because no identity was removed
    // and "which request was this" still has to be answerable.
    subject_label: subject.name,
    kind: "export",
    actioned_by: ctx.userId,
    notes: `Article 15 export as ${format.toUpperCase()}`,
  })

  console.log(
    `[gdpr] export subject=${subject.id} company=${ctx.companyId} by=${ctx.userId} format=${format}`,
  )

  const payload = {
    generatedAt,
    company: { id: company?.id, name: company?.name },
    subject: {
      id: subject.id,
      name: subject.name,
      email: subject.email,
      phone: subject.phone,
      role: subject.role,
      active: subject.is_active,
      joined: subject.created_at,
      anonymised: subject.anonymised_at,
      workingDays: subject.working_days,
      trades: subject.trades,
      shiftStart: subject.sign_in_time,
      shiftEnd: subject.sign_out_time,
      hourlyRate: subject.hourly_rate,
    },
    sections: sections.map(s => ({
      label: s.label,
      source: `${s.table}.${s.column}`,
      count: s.rows.length,
      error: s.error,
      rows: s.rows,
    })),
    notes: ERASURE_CAVEATS,
  }

  if (format === "json") {
    return new NextResponse(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${filename(subject.name, "json")}"`,
        "Cache-Control": "no-store",
      },
    })
  }

  const pdf = await renderSubjectExportPdf(payload)
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename(subject.name, "pdf")}"`,
      "Cache-Control": "no-store",
    },
  })
}

function filename(name: string, ext: string): string {
  const slug = String(name || "worker")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 40)
  return `vantro-data-${slug || "worker"}-${new Date().toISOString().slice(0, 10)}.${ext}`
}
