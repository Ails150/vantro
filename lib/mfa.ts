// lib/mfa.ts
//
// Two-factor policy: who has to have it, and who has to use it right now.
//
// The policy is a pure function over two facts -- the session's assurance level
// and whether the account has a verified authenticator -- deliberately
// separated from the Supabase calls that produce those facts. This is the code
// that can lock every administrator out of the product, including the only
// superadmin, so it is the code that gets tested against a table of cases
// rather than reasoned about once and shipped.
//
// SUPABASE'S MODEL, BRIEFLY
//   aal1  signed in with a password
//   aal2  signed in with a password AND satisfied a second factor
// A session starts at aal1. Verifying a TOTP code upgrades it to aal2 for the
// life of that session. A user with no enrolled factor can never reach aal2,
// which is why "must enrol" and "must verify" are different outcomes and not
// the same one with a different message.
//
// THE RULE
//   superadmin  MUST have a factor, and MUST be at aal2
//   admin       MAY have a factor; if they have one they MUST be at aal2
//   everyone else  unaffected -- field roles authenticate with a PIN and a
//                  field token and never hold a Supabase session at all
//
// The asymmetry is the point. Making it optional for admins and mandatory for
// superadmins matches what the two roles can actually do: an admin can see one
// company's data, a superadmin can reach every tenant and can build or destroy
// the demo company. The blast radius is different, so the requirement is.
//
// "IF YOU HAVE ONE YOU MUST USE IT" is why an optional factor still has teeth.
// A second factor that can be skipped by ignoring the prompt is decoration. So
// enrolling is a choice; having enrolled, using it is not.

/** Roles that hold a Supabase session at all. Field roles use a JWT and a PIN. */
export const MFA_RELEVANT_ROLES = ["admin", "superadmin", "support"] as const

/** Roles for which a second factor is mandatory rather than offered. */
export const MFA_REQUIRED_ROLES = ["superadmin", "support"] as const

export type AssuranceLevel = "aal1" | "aal2" | null

export type MfaState = {
  /** The assurance level of the session as it stands. */
  currentLevel: AssuranceLevel
  /** True when the account has at least one VERIFIED authenticator. */
  hasVerifiedFactor: boolean
}

export type MfaOutcome =
  /** Nothing to do. Either not applicable, or already satisfied. */
  | "ok"
  /** Has a factor, session is still aal1: enter a code. */
  | "must_verify"
  /** Role requires a factor and has none: set one up. */
  | "must_enrol"

/**
 * What this user must do before they may use the admin surface.
 *
 * Takes facts, returns a verdict. No I/O, no redirects, no knowledge of Next.
 */
export function mfaOutcome(role: string | null | undefined, state: MfaState): MfaOutcome {
  const r = String(role || "")

  // Field roles never hold a Supabase session, so there is nothing here to
  // enforce and nothing to offer. Returning "ok" rather than throwing means a
  // mis-set role degrades to today's behaviour instead of locking somebody out.
  if (!MFA_RELEVANT_ROLES.includes(r as any)) return "ok"

  // Already stepped up. Nothing further, whatever the role.
  if (state.currentLevel === "aal2") return "ok"

  // Has an authenticator but has not used it on this session. This applies to
  // an optional admin factor too: a second factor that can be skipped by
  // ignoring the prompt is decoration.
  if (state.hasVerifiedFactor) return "must_verify"

  // No factor. Mandatory roles are sent to set one up; optional roles proceed.
  if (MFA_REQUIRED_ROLES.includes(r as any)) return "must_enrol"

  return "ok"
}

/** Is a second factor mandatory for this role? Used to label the UI. */
export function mfaRequiredFor(role: string | null | undefined): boolean {
  return MFA_REQUIRED_ROLES.includes(String(role || "") as any)
}

/**
 * Paths that must stay reachable no matter what the outcome is.
 *
 * Without this list the enforcement is a trap: a superadmin with no factor gets
 * sent to the enrolment page, which is itself under /admin, which sends them to
 * the enrolment page. Sign-out is on the list for the same reason -- somebody
 * who cannot complete enrolment must still be able to leave.
 *
 * Kept as prefixes rather than exact matches so that a nested route under any
 * of them (an API call the enrolment screen makes) is exempt too.
 */
const EXEMPT_PREFIXES = [
  "/security",          // enrol and verify screens, and their API
  "/api/security",
  "/login",
  "/signup",
  "/join",
  "/set-password",
  "/reset-password",
  "/auth",              // the OAuth/callback exchange
  "/api/auth",
  "/installer",         // field app: PIN and field token, no Supabase session
  "/api/installer",
  "/api/signin",
  "/api/signout",
  "/api/cron",          // cron carries a secret, not a user session
  "/verify",            // the public evidence-pack verifier
  "/privacy",
  "/support",
]

/** True when a path must be allowed through regardless of MFA state. */
export function isMfaExempt(pathname: string): boolean {
  const p = String(pathname || "")
  if (p === "/") return true
  return EXEMPT_PREFIXES.some(prefix => p === prefix || p.startsWith(prefix + "/"))
}

/**
 * Read the assurance level out of a Supabase access token.
 *
 * Decoded rather than verified: the token has already been verified by
 * getUser() against the auth server before this is called, and re-verifying a
 * signature in middleware would mean shipping the JWT secret to the edge. This
 * only reads a claim from a token that is already known to be genuine.
 *
 * Returns null on anything unparseable, and the caller treats null as "cannot
 * tell" rather than as aal1 -- see the fail-open note in the middleware.
 */
export function assuranceLevelFromToken(accessToken: string | null | undefined): AssuranceLevel {
  if (!accessToken || typeof accessToken !== "string") return null
  const parts = accessToken.split(".")
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1]))
    const aal = payload?.aal
    return aal === "aal1" || aal === "aal2" ? aal : null
  } catch {
    return null
  }
}

function base64UrlDecode(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/")
  const withPadding = padded + "=".repeat((4 - (padded.length % 4)) % 4)
  // atob exists in the edge runtime and in Node 16+, which covers both places
  // this runs. Buffer does not exist on the edge, so it is not used here.
  const binary = atob(withPadding)
  // The payload is UTF-8; atob gives latin1, so it has to be re-decoded or a
  // non-ASCII claim (a name with an accent) corrupts the JSON parse.
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/**
 * Does this user object carry a verified authenticator?
 *
 * Supabase puts every factor on user.factors, verified or not. An unverified
 * factor is an abandoned enrolment -- somebody who opened the QR code and
 * closed the tab -- and must NOT count, or that person is locked out by a
 * factor they never finished setting up and cannot produce a code for.
 */
export function hasVerifiedFactor(user: any): boolean {
  const factors = user?.factors
  if (!Array.isArray(factors)) return false
  return factors.some((f: any) => f?.status === "verified")
}
