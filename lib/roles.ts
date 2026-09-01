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

/** visit_assignments.role: what a person is on a visit, not their account role. */
export const VISIT_ROLE_DEFAULT = 'operative'
export const LEGACY_VISIT_ROLE = 'installer'
export const VISIT_ROLES: string[] = [VISIT_ROLE_DEFAULT, LEGACY_VISIT_ROLE]
