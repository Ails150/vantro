/**
 * Role vocabulary.
 *
 * users.role used to carry 'installer', which is construction-only language in
 * a product that also serves cleaning, security and facilities. The stored
 * value is migrating to 'field'.
 *
 * COMPATIBILITY WINDOW. Both values are accepted on read for one release, so
 * a half-deployed fleet cannot lock anyone out: rows migrate ahead of the code
 * that reads them, and an old client that still writes 'installer' keeps
 * working. Everything writes 'field'.
 *
 * To close the window: delete LEGACY_FIELD_ROLE and everything that references
 * it. This file is the only place to change.
 */

export const FIELD_ROLE = 'field'
export const LEGACY_FIELD_ROLE = 'installer'

/** For `.in('role', ...)` queries. Remove the legacy entry to close the window. */
export const FIELD_ROLES: string[] = [FIELD_ROLE, LEGACY_FIELD_ROLE]

/** Field worker plus the supervising roles that also appear on a rota. */
export const FIELD_AND_FOREMAN: string[] = [...FIELD_ROLES, 'foreman']
export const FIELD_FOREMAN_SUBBIE: string[] = [...FIELD_ROLES, 'foreman', 'subcontractor']

export function isFieldRole(role?: string | null): boolean {
  return role === FIELD_ROLE || role === LEGACY_FIELD_ROLE
}

export function isFieldOrSupervisor(role?: string | null): boolean {
  return isFieldRole(role) || role === 'foreman' || role === 'subcontractor'
}

/**
 * Normalise a role arriving from a client or a CSV. Anything that means "field
 * worker" is stored as the new value, so the legacy string stops spreading.
 */
export function normaliseRole(role?: string | null): string {
  const r = (role || '').trim().toLowerCase()
  if (r === LEGACY_FIELD_ROLE || r === FIELD_ROLE) return FIELD_ROLE
  return r
}

/**
 * Roles that sign in with a PIN and a field token, as an ALLOWLIST.
 *
 * This is a security control, not a convenience: setup-pin and the reset
 * routes use it to refuse an office account a PIN. An allowlist because the
 * failure mode of a denylist here is silent -- a role added later would be
 * able to hold a PIN because nobody remembered to exclude it.
 *
 * It was written out by hand as ['installer', 'subcontractor'] inside
 * setup-pin, which is how the lockout happened: /api/admin/team, the CSV
 * import and /api/onboarding all store the new value 'field', and a worker
 * added any of those ways could not set a PIN and so could not log in at all.
 *
 * foreman is here because the product sells it that way -- the role picker
 * says "Supervisor - PIN app + alert emails". A foreman also holds a
 * dashboard session, and that is the deliberate part: a supervisor is a
 * person who is on site and in the office, and refusing them the app would
 * make the role meaningless.
 */
export const PIN_ROLES: string[] = FIELD_FOREMAN_SUBBIE

export function canHoldPin(role?: string | null): boolean {
  return PIN_ROLES.includes(String(role || ''))
}

/**
 * The whole question, for one account: may this person hold a PIN?
 *
 * A field role may. So may an office account whose owner has said they also
 * work on site (users.works_on_site) -- the solo subcontractor who is the
 * company and the crew, and who otherwise has to choose between running the
 * business and being able to sign in to their own job.
 *
 * That flag is set from an authenticated dashboard session by the person
 * themselves. It is NOT inferred from already having a PIN: an account with no
 * PIN permanently satisfies "has no PIN yet", which is precisely how anybody
 * who knew an admin's email address could put one on their account.
 */
export function mayHoldPin(user: { role?: string | null; works_on_site?: boolean | null } | null | undefined): boolean {
  if (!user) return false
  return canHoldPin(user.role) || user.works_on_site === true
}

/** visit_assignments.role: what a person is on a visit, not their account role. */
export const VISIT_ROLE_DEFAULT = 'operative'
export const LEGACY_VISIT_ROLE = 'installer'
export const VISIT_ROLES: string[] = [VISIT_ROLE_DEFAULT, LEGACY_VISIT_ROLE]
