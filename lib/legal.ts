// lib/legal.ts
//
// Which version of each legal document is current, and where it is published.
//
// The version strings were previously a bare "1.0" typed into the accept-DPA
// route. That works right up until the documents are reissued, at which point
// every company's record says it accepted 1.0 and nothing in the codebase knows
// what 1.0 was or that it has moved on. Acceptance records are evidence, and
// evidence whose subject is unidentifiable is not evidence.
//
// Bump a version here when the published document changes materially, and the
// product will show the gap to admins whose acceptance predates it.

/** The Terms of Service the signup checkbox accepts. */
export const TERMS_VERSION = "1.0"

/** The Data Processing Agreement the signup checkbox accepts. */
export const DPA_VERSION = "1.0"

/**
 * Where each is published. Relative, so it works on any environment.
 *
 * The DPA points at the PDF that is actually in force today and is already
 * linked from the compliance panel, NOT at the redraft in docs/legal/dpa.md,
 * which is marked "do not publish" and has not been through a solicitor. A
 * signup checkbox must link to the document the company is really agreeing to;
 * linking to a draft would make the acceptance record worthless and would be
 * the one lie this whole feature exists to prevent.
 */
export const TERMS_URL = "/legal/terms"
export const DPA_URL = "/legal/Vantro_Data_Processing_Agreement.pdf"
export const PRIVACY_URL = "/privacy"

export type LegalAcceptance = {
  terms_accepted_at: string
  terms_accepted_by_name: string
  terms_version: string
  dpa_accepted_at: string
  dpa_accepted_by_name: string
  dpa_version: string
}

/**
 * The columns to stamp on a company when acceptance happens.
 *
 * One checkbox covers both documents, so both are stamped at the same instant
 * with the same name -- but into their own columns, because they are separate
 * documents that will version independently. See the migration for why that is
 * not over-engineering.
 *
 * `acceptedByName` is stored as a value rather than only a foreign key. The
 * user row can be renamed, deactivated, or anonymised by a GDPR erasure, and
 * the acceptance record has to survive all three and still say who agreed.
 */
export function acceptanceColumns(acceptedByName: string, at: Date = new Date()): LegalAcceptance {
  const iso = at.toISOString()
  const name = acceptedByName.trim() || "Admin"
  return {
    terms_accepted_at: iso,
    terms_accepted_by_name: name,
    terms_version: TERMS_VERSION,
    dpa_accepted_at: iso,
    dpa_accepted_by_name: name,
    dpa_version: DPA_VERSION,
  }
}

/**
 * Is a stored acceptance still current?
 *
 * A missing timestamp and an out-of-date version are different states and the
 * product should say so differently: one company never agreed to anything, the
 * other agreed to something we have since changed.
 */
export type AcceptanceState = "missing" | "outdated" | "current"

export function acceptanceState(
  acceptedAt: string | null | undefined,
  acceptedVersion: string | null | undefined,
  currentVersion: string,
): AcceptanceState {
  if (!acceptedAt) return "missing"
  // A stamped timestamp with no version is from before versions were recorded.
  // It is an acceptance of *something*, so it is treated as outdated rather
  // than as nothing at all.
  if (!acceptedVersion) return "outdated"
  return acceptedVersion === currentVersion ? "current" : "outdated"
}
