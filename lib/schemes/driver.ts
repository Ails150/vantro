// lib/schemes/driver.ts
//
// The one seam between Vantro and a competent person scheme.
//
// THERE IS NO LIVE DRIVER, ON PURPOSE. Neither scheme publishes API docs or a
// sandbox that could be found, so a real client would be invented endpoints.
// LIVE_DRIVERS is empty and SCHEME_MODE=live therefore reaches nothing. Adding
// one is a deliberate code change, made with the scheme's real documentation
// and after the owner has confirmed real jobs may be registered.

import crypto from "crypto"

export type SchemeId = "certass" | "fensa"
export type SchemeEnvironment = "simulator" | "live"

export const SCHEMES: SchemeId[] = ["certass", "fensa"]
export const SCHEME_LABEL: Record<SchemeId, string> = { certass: "Certass", fensa: "FENSA" }

export function toScheme(value: unknown): SchemeId | null {
  return value === "certass" || value === "fensa" ? value : null
}

export type RegistrationRequest = {
  /** Stable per job, so a scheme that honours it can refuse a repeat. */
  idempotencyKey: string
  scheme: SchemeId
  memberNumber: string
  propertyAddress: string
  workType: string
  windows: number
  doors: number
  completionDate: string
}

export type RegisterResult =
  | { outcome: "registered"; certificateNumber: string }
  /** The scheme definitely did not accept it. Safe to fix and retry. */
  | { outcome: "rejected"; reason: string }
  /** It may have accepted it. Must be checked by a person before any retry. */
  | { outcome: "ambiguous"; reason: string }

export type ValidateResult = { ok: true } | { ok: false; reason: string }

export interface SchemeDriver {
  environment: SchemeEnvironment
  validateKey(args: { apiKey: string; memberNumber: string }): Promise<ValidateResult>
  register(request: RegistrationRequest, apiKey: string): Promise<RegisterResult>
}

/**
 * Stands in for a scheme. Its numbers always start SIM- so one can never be
 * mistaken for a real certificate.
 *
 * Put SIM-REJECT or SIM-TIMEOUT in the property address to rehearse a failure.
 * SIM-TIMEOUT accepts the job and then reports nothing, because that is the
 * dangerous case: the scheme has it and we do not know.
 */
export function createSimulator(): SchemeDriver & { accepted: Map<string, string> } {
  const accepted = new Map<string, string>()
  return {
    environment: "simulator",
    accepted,
    async validateKey({ apiKey, memberNumber }) {
      if (!/^sim_.{4,}$/.test(apiKey)) return { ok: false, reason: "The scheme did not recognise that API key." }
      if (!memberNumber.trim()) return { ok: false, reason: "Enter your member number." }
      return { ok: true }
    },
    async register(request) {
      if (request.propertyAddress.includes("SIM-REJECT")) {
        return { outcome: "rejected", reason: "The scheme rejected the property address." }
      }
      const certificateNumber = `SIM-${request.scheme.toUpperCase()}-${crypto
        .createHash("sha256").update(request.idempotencyKey).digest("hex").slice(0, 10).toUpperCase()}`
      accepted.set(request.idempotencyKey, certificateNumber)
      if (request.propertyAddress.includes("SIM-TIMEOUT")) {
        return { outcome: "ambiguous", reason: "The scheme did not respond in time." }
      }
      return { outcome: "registered", certificateNumber }
    },
  }
}

const LIVE_DRIVERS: Partial<Record<SchemeId, SchemeDriver>> = {}

type Env = Record<string, string | undefined>

export type Availability =
  | { available: true; driver: SchemeDriver }
  | { available: false; reason: string }

/**
 * Does this company see anything of this feature at all?
 *
 * Only companies in SCHEME_SIM_COMPANIES, until a live driver exists. Everywhere
 * the feature shows (Settings, the job card, Today, the Audit Pack) and every
 * route behind it asks this. A real customer must not be able to mark a real
 * job notifiable, get a SIM- number, and believe it has been registered.
 */
export function schemeFeatureEnabled(companyId: string | null | undefined, env: Env = process.env): boolean {
  if (!companyId) return false
  if (env.SCHEME_MODE === "live" && Object.keys(LIVE_DRIVERS).length > 0) return true
  return (env.SCHEME_SIM_COMPANIES || "").split(",").map(s => s.trim()).includes(companyId)
}

/** May this company register with this scheme, and through what? */
export function schemeAvailability(scheme: SchemeId, companyId: string, env: Env = process.env): Availability {
  if (!schemeFeatureEnabled(companyId, env)) {
    return { available: false, reason: "Scheme registration is not switched on yet." }
  }
  if (env.SCHEME_MODE === "live") {
    const driver = LIVE_DRIVERS[scheme]
    if (driver) return { available: true, driver }
    return { available: false, reason: `Live ${SCHEME_LABEL[scheme]} registration is not switched on yet.` }
  }
  return { available: true, driver: createSimulator() }
}
