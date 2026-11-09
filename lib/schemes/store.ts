// lib/schemes/store.ts
//
// SchemeStore on Supabase, with the service role. Callers have already checked
// who is asking. Every read is pinned to a company or a job already loaded
// through one.

import type { SchemeJob, SchemeStore } from "./register"

export const SCHEME_JOB_FIELDS =
  "id, company_id, name, status, notifiable, scheme, property_address, work_type, windows_count, doors_count, " +
  "completion_date, homeowner_name, homeowner_email, certificate_number, registration_status, registration_error, " +
  "registration_attempted_at, registration_environment, homeowner_email_status, homeowner_email_error, homeowner_email_attempted_at"

const must = (error: any, what: string) => {
  if (error) throw new Error(`${what}: ${error.message}`)
}

export function supabaseSchemeStore(service: any): SchemeStore {
  return {
    async loadJob(companyId, jobId) {
      const { data, error } = await service.from("jobs").select(SCHEME_JOB_FIELDS)
        .eq("id", jobId).eq("company_id", companyId).maybeSingle()
      must(error, "load job")
      return (data as SchemeJob) || null
    },
    async loadCompany(companyId) {
      const { data, error } = await service.from("companies").select("name, plan").eq("id", companyId).maybeSingle()
      must(error, "load company")
      return data || null
    },
    async loadConnection(companyId, scheme) {
      const { data, error } = await service.from("scheme_connections")
        .select("api_key_encrypted, member_number, active")
        .eq("company_id", companyId).eq("scheme", scheme).maybeSingle()
      must(error, "load connection")
      return data || null
    },
    async claim(companyId, jobId, afterManualCheck) {
      const { data, error } = await service.rpc("claim_scheme_registration", {
        p_company_id: companyId, p_job_id: jobId, p_after_manual_check: afterManualCheck,
      })
      must(error, "claim")
      const row = Array.isArray(data) ? data[0] : data
      return { claimed: !!row?.claimed, status: row?.current_status || "not_found" }
    },
    async insertRegistration(row) {
      const { data, error } = await service.from("scheme_registrations")
        .insert(row).select("certificate_number").single()
      if (!error) return { certificateNumber: data.certificate_number }
      if (error.code !== "23505") throw new Error(error.message)
      // This job already has a record. The record stands, and a second number
      // would mean it has been registered twice.
      const { data: existing, error: readError } = await service.from("scheme_registrations")
        .select("certificate_number").eq("job_id", row.job_id).single()
      must(readError, "read existing registration")
      if (existing.certificate_number !== row.certificate_number) {
        throw new Error(`job already holds certificate ${existing.certificate_number}`)
      }
      return { certificateNumber: existing.certificate_number }
    },
    async markRegistered(jobId, certificateNumber, environment) {
      const { error } = await service.from("jobs").update({
        registration_status: "registered",
        registration_error: null,
        certificate_number: certificateNumber,
        registration_environment: environment,
        registered_at: new Date().toISOString(),
      }).eq("id", jobId)
      must(error, "mark registered")
    },
    async markProblem(jobId, status, reason) {
      const { error } = await service.from("jobs")
        .update({ registration_status: status, registration_error: reason.slice(0, 1000) }).eq("id", jobId)
      must(error, "mark problem")
    },
    async claimEmail(jobId) {
      const stale = new Date(Date.now() - 3 * 60 * 1000).toISOString()
      const { data, error } = await service.from("jobs")
        .update({ homeowner_email_status: "sending", homeowner_email_attempted_at: new Date().toISOString() })
        .eq("id", jobId)
        .or(`homeowner_email_status.in.(not_sent,failed),and(homeowner_email_status.eq.sending,homeowner_email_attempted_at.lt."${stale}")`)
        .select("id")
      must(error, "claim email")
      return (data || []).length === 1
    },
    async markEmail(jobId, status, reason) {
      const { error } = await service.from("jobs")
        .update({ homeowner_email_status: status, homeowner_email_error: reason ? reason.slice(0, 1000) : null })
        .eq("id", jobId)
      must(error, "mark email")
    },
  }
}
