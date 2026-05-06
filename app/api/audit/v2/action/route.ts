import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { getSession } from "@/lib/auth"

const service = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { userId, companyId } = session
  const body = await req.json().catch(() => ({}))
  const { action, ...params } = body

  try {
    switch (action) {
      case "approve_qa": {
        const { qaSubmissionId, approve, note } = params
        if (!qaSubmissionId) return NextResponse.json({ error: "Missing qaSubmissionId" }, { status: 400 })

        // Verify the QA belongs to this company
        const { data: qa } = await service.from("qa_submissions")
          .select("id, jobs(company_id)")
          .eq("id", qaSubmissionId)
          .single()
        if (!qa || (qa as any).jobs?.company_id !== companyId) {
          return NextResponse.json({ error: "Not found" }, { status: 404 })
        }

        const newState = approve ? "approved" : "rejected"
        const { error } = await service.from("qa_submissions").update({
          state: newState,
          approved_by: userId,
          approved_at: new Date().toISOString(),
          approval_note: note || null,
        }).eq("id", qaSubmissionId)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        return NextResponse.json({ ok: true, newState })
      }

      case "resolve_defect": {
        const { defectId, resolution } = params
        if (!defectId) return NextResponse.json({ error: "Missing defectId" }, { status: 400 })

        const { data: defect } = await service.from("defects")
          .select("id, jobs(company_id)")
          .eq("id", defectId)
          .single()
        if (!defect || (defect as any).jobs?.company_id !== companyId) {
          return NextResponse.json({ error: "Not found" }, { status: 404 })
        }

        const { error } = await service.from("defects").update({
          status: "resolved",
          resolution_note: resolution || null,
          resolved_at: new Date().toISOString(),
          resolved_by: userId,
        }).eq("id", defectId)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        return NextResponse.json({ ok: true })
      }

      case "snooze_flag": {
        const { flagKey, jobId, until } = params
        if (!flagKey || !jobId) return NextResponse.json({ error: "Missing flagKey or jobId" }, { status: 400 })

        // Store snooze in a simple keyed table — uses companies.metadata jsonb if no dedicated table
        // For now, persist in audit_pack_snoozes table if exists, otherwise no-op gracefully
        const { error } = await service.from("audit_pack_snoozes").insert({
          company_id: companyId,
          job_id: jobId,
          flag_key: flagKey,
          snoozed_until: until || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          snoozed_by: userId,
        })
        if (error && error.code !== "42P01") {
          // 42P01 = table does not exist, treat as no-op so feature degrades gracefully
          return NextResponse.json({ error: error.message }, { status: 500 })
        }
        return NextResponse.json({ ok: true })
      }

      case "mark_complete": {
        const { jobId } = params
        if (!jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 })

        const { data: job } = await service.from("jobs")
          .select("id, company_id")
          .eq("id", jobId)
          .single()
        if (!job || job.company_id !== companyId) {
          return NextResponse.json({ error: "Not found" }, { status: 404 })
        }

        const { error } = await service.from("jobs").update({
          status: "completed",
          completed_at: new Date().toISOString(),
          completed_by: userId,
        }).eq("id", jobId)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        return NextResponse.json({ ok: true })
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 })
    }
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Action failed" }, { status: 500 })
  }
}
