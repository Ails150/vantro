// lib/schemes/register.ts
//
// The only path that registers a job with a scheme: sign-off and the Retry
// button both call registerJob. Storage, the driver and email are passed in, so
// the worked example runs this exact code.

import { can, toPlan } from "../plan"
import { open } from "../secret-box"
import { sendHomeownerConfirmation, type EmailResult } from "./homeowner-email"
import {
  SCHEME_LABEL,
  schemeAvailability,
  schemeFeatureEnabled,
  toScheme,
  type Availability,
  type RegisterResult,
  type SchemeId,
} from "./driver"

export type RegistrationStatus =
  "not_required" | "pending" | "registering" | "registered" | "failed" | "unknown"

export type SchemeJob = {
  id: string
  company_id: string
  name: string
  status: string | null
  notifiable: boolean
  scheme: string | null
  property_address: string | null
  work_type: string | null
  windows_count: number | null
  doors_count: number | null
  completion_date: string | null
  homeowner_name: string | null
  homeowner_email: string | null
  certificate_number: string | null
  registration_status: RegistrationStatus
  registration_error: string | null
  registration_attempted_at: string | null
  registration_environment: "simulator" | "live" | null
  homeowner_email_status: "not_sent" | "sending" | "sent" | "failed" | "skipped_simulator"
  homeowner_email_error: string | null
  homeowner_email_attempted_at: string | null
}

export type SchemeConnection = { api_key_encrypted: string; member_number: string; active: boolean }

export type NewRegistration = {
  company_id: string
  job_id: string
  scheme: SchemeId
  environment: "simulator" | "live"
  certificate_number: string
  member_number: string
  property_address: string
  work_type: string
  windows_count: number
  doors_count: number
  completion_date: string
  registered_by: string | null
}

export interface SchemeStore {
  loadJob(companyId: string, jobId: string): Promise<SchemeJob | null>
  loadCompany(companyId: string): Promise<{ name: string; plan: unknown } | null>
  loadConnection(companyId: string, scheme: SchemeId): Promise<SchemeConnection | null>
  claim(companyId: string, jobId: string, afterManualCheck: boolean): Promise<{ claimed: boolean; status: string }>
  /** Returns the number on record: the existing one if this job already has a row. */
  insertRegistration(row: NewRegistration): Promise<{ certificateNumber: string }>
  markRegistered(jobId: string, certificateNumber: string, environment: "simulator" | "live"): Promise<void>
  markProblem(jobId: string, status: "failed" | "unknown", reason: string): Promise<void>
  claimEmail(jobId: string): Promise<boolean>
  markEmail(jobId: string, status: "sent" | "failed" | "skipped_simulator", reason: string | null): Promise<void>
}

export type RegisterDeps = {
  store: SchemeStore
  availability?: (scheme: SchemeId, companyId: string) => Availability
  sendEmail?: typeof sendHomeownerConfirmation
  env?: Record<string, string | undefined>
}

export type RegisterOutcome = {
  status: RegistrationStatus | "not_found" | "not_signed_off" | "in_progress" | "needs_check"
  reason?: string
  certificateNumber?: string
  email?: EmailResult
}

export function isSignedOff(status: string | null | undefined): boolean {
  return status === "completed" || status === "complete"
}

/** Everything wrong with a job's details, so the admin fixes them in one go. */
export function missingForRegistration(job: SchemeJob): string[] {
  const missing: string[] = []
  if (!toScheme(job.scheme)) missing.push("scheme")
  if (!job.property_address?.trim()) missing.push("property address")
  if (!job.work_type?.trim()) missing.push("work type")
  if ((job.windows_count ?? 0) + (job.doors_count ?? 0) <= 0) missing.push("number of windows or doors")
  if (!job.completion_date) missing.push("completion date")
  return missing
}

export const connectionContext = (companyId: string, scheme: string) => `scheme:${companyId}:${scheme}`

export async function registerJob(
  deps: RegisterDeps,
  args: { companyId: string; jobId: string; actorUserId: string | null; afterManualCheck?: boolean },
): Promise<RegisterOutcome> {
  const { store } = deps
  // Before any read, so sign-off for every other company is untouched.
  if (!schemeFeatureEnabled(args.companyId, deps.env || process.env)) return { status: "not_required" }
  const availability = deps.availability || ((s, c) => schemeAvailability(s, c, deps.env || process.env))
  const job = await store.loadJob(args.companyId, args.jobId)
  if (!job) return { status: "not_found" }
  if (!job.notifiable) return { status: "not_required" }
  if (!isSignedOff(job.status)) return { status: "not_signed_off", reason: "The job has not been signed off." }

  // Already done: never go near the scheme. Only the email can still be owed.
  if (job.registration_status === "registered") {
    return {
      status: "registered",
      certificateNumber: job.certificate_number || undefined,
      email: await deliverEmail(deps, job, job.certificate_number || ""),
    }
  }

  const claim = await store.claim(args.companyId, args.jobId, !!args.afterManualCheck)
  if (!claim.claimed) {
    if (claim.status === "unknown") {
      return { status: "needs_check", reason: "Check the scheme portal before retrying." }
    }
    if (claim.status === "registering") return { status: "in_progress" }
    return { status: claim.status as RegistrationStatus }
  }

  const fail = async (reason: string): Promise<RegisterOutcome> => {
    await store.markProblem(job.id, "failed", reason)
    return { status: "failed", reason }
  }

  const company = await store.loadCompany(args.companyId)
  if (!can(toPlan(company?.plan), "schemeRegistration")) {
    return fail("Scheme registration is on the Full Suite plan.")
  }

  const missing = missingForRegistration(job)
  if (missing.length > 0) return fail(`Add the ${missing.join(", ")} to this job.`)
  const scheme = toScheme(job.scheme)!
  const label = SCHEME_LABEL[scheme]

  const route = availability(scheme, args.companyId)
  if (!route.available) return fail(route.reason)

  const connection = await store.loadConnection(args.companyId, scheme)
  if (!connection?.active) return fail(`Connect ${label} in Settings, then retry.`)

  let apiKey: string
  try {
    apiKey = open(connection.api_key_encrypted, connectionContext(args.companyId, scheme), deps.env || process.env)
  } catch {
    return fail(`The saved ${label} API key could not be read. Paste it again in Settings.`)
  }

  const windows = job.windows_count ?? 0
  const doors = job.doors_count ?? 0
  let result: RegisterResult
  try {
    result = await route.driver.register({
      idempotencyKey: job.id,
      scheme,
      memberNumber: connection.member_number,
      propertyAddress: job.property_address!.trim(),
      workType: job.work_type!.trim(),
      windows,
      doors,
      completionDate: job.completion_date!,
    }, apiKey)
  } catch (e: any) {
    // A thrown call may have reached the scheme. Treated as unknown, always.
    result = { outcome: "ambiguous", reason: e?.message || "The call to the scheme did not complete." }
  }

  if (result.outcome === "rejected") return fail(`${label} refused this job: ${result.reason}`)
  if (result.outcome === "ambiguous") {
    const reason = `${result.reason} ${label} may have received it. Check its portal before retrying.`
    await store.markProblem(job.id, "unknown", reason)
    return { status: "unknown", reason }
  }

  // The scheme has it now. From here a failure must not lose the number.
  let certificateNumber: string
  try {
    ;({ certificateNumber } = await store.insertRegistration({
      company_id: args.companyId,
      job_id: job.id,
      scheme,
      environment: route.driver.environment,
      certificate_number: result.certificateNumber,
      member_number: connection.member_number,
      property_address: job.property_address!.trim(),
      work_type: job.work_type!.trim(),
      windows_count: windows,
      doors_count: doors,
      completion_date: job.completion_date!,
      registered_by: args.actorUserId,
    }))
    await store.markRegistered(job.id, certificateNumber, route.driver.environment)
  } catch (e: any) {
    const reason =
      `${label} accepted this job as ${result.certificateNumber}, but Vantro could not save it (${e?.message || "database error"}). ` +
      "Do not register it again. Contact support with this number."
    await store.markProblem(job.id, "unknown", reason)
    return { status: "unknown", reason, certificateNumber: result.certificateNumber }
  }

  const fresh = { ...job, certificate_number: certificateNumber, registration_environment: route.driver.environment }
  return { status: "registered", certificateNumber, email: await deliverEmail(deps, fresh, certificateNumber) }
}

async function deliverEmail(deps: RegisterDeps, job: SchemeJob, certificateNumber: string): Promise<EmailResult | undefined> {
  if (job.homeowner_email_status === "sent" || job.homeowner_email_status === "skipped_simulator") return undefined
  if (!(await deps.store.claimEmail(job.id))) return undefined

  const company = await deps.store.loadCompany(job.company_id)
  const send = deps.sendEmail || sendHomeownerConfirmation
  let result: EmailResult
  try {
    result = await send({
      jobId: job.id,
      to: job.homeowner_email,
      companyName: company?.name || "Your installer",
      scheme: toScheme(job.scheme)!,
      propertyAddress: job.property_address || "",
      certificateNumber,
      simulated: job.registration_environment !== "live",
    }, deps.env || process.env)
  } catch (e: any) {
    result = { status: "failed", reason: e?.message || "The email could not be sent." }
  }
  await deps.store.markEmail(job.id, result.status, result.status === "sent" ? null : result.reason)
  return result
}

// ---------------------------------------------------------------------------
// What Today shows
// ---------------------------------------------------------------------------
const STUCK_MS = 3 * 60 * 1000
const REGISTRATION_DEADLINE_DAYS = 21

export type Attention = {
  jobId: string
  jobName: string
  scheme: string | null
  kind: "failed" | "unknown" | "not_attempted" | "email"
  reason: string
  /** Retry must carry the admin's word that the scheme does not have it. */
  needsPortalCheck: boolean
  deadline: string | null
}

export function registrationDeadline(completionDate: string | null): string | null {
  if (!completionDate) return null
  const ms = Date.parse(`${completionDate.slice(0, 10)}T12:00:00Z`)
  if (!Number.isFinite(ms)) return null
  return new Date(ms + REGISTRATION_DEADLINE_DAYS * 86400000).toISOString().slice(0, 10)
}

/** Null when nothing is wrong. */
export function needsAttention(job: SchemeJob, now: Date = new Date()): Attention | null {
  if (!job.notifiable) return null
  const base = { jobId: job.id, jobName: job.name, scheme: job.scheme, deadline: registrationDeadline(job.completion_date) }
  const age = (at: string | null) => (at ? now.getTime() - Date.parse(at) : Infinity)

  switch (job.registration_status) {
    case "failed":
      return { ...base, kind: "failed", reason: job.registration_error || "Registration failed.", needsPortalCheck: false }
    case "unknown":
      return { ...base, kind: "unknown", reason: job.registration_error || "The outcome is not known.", needsPortalCheck: true }
    case "registering":
      if (age(job.registration_attempted_at) <= STUCK_MS) return null
      return {
        ...base,
        kind: "unknown",
        reason: "The last attempt did not finish, so the scheme may have received it. Check its portal before retrying.",
        needsPortalCheck: true,
      }
    case "pending":
      if (!isSignedOff(job.status)) return null
      return { ...base, kind: "not_attempted", reason: "Signed off, but registration has not run.", needsPortalCheck: false }
    case "registered": {
      const stuck = job.homeowner_email_status === "sending" && age(job.homeowner_email_attempted_at) > STUCK_MS
      if (job.homeowner_email_status !== "failed" && job.homeowner_email_status !== "not_sent" && !stuck) return null
      return {
        ...base,
        kind: "email",
        deadline: null,
        reason: `Registered, but the homeowner has not been told: ${job.homeowner_email_error || "the email did not finish sending."}`,
        needsPortalCheck: false,
      }
    }
    default:
      return null
  }
}
