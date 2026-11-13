// lib/ownership.ts
//
// Does this row belong to this company? Asked BEFORE a route touches anything.
//
// Routes here use the service role, which bypasses row level security. So any
// id taken from a request -- body, query or path -- is only as safe as the
// check the route makes on it. Scoping the last statement is not enough when
// the statements before it do the damage (see /api/jobs/delete, fixed in
// 1892020): the check comes first and gates everything after it.
//
// Another company's row and a row that does not exist give the same answer,
// so a caller cannot use a route to learn which ids exist in other tenants.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value)
}

/** Tables with their own company_id column that routes look rows up in. */
export type OwnedTable = string

/**
 * The row's id if it exists in `table` AND its company_id is companyId,
 * otherwise null. Never throws: a database error is a refusal.
 */
export async function ownedId(
  service: any,
  table: OwnedTable,
  id: unknown,
  companyId: string | null | undefined,
): Promise<string | null> {
  if (!isUuid(id) || !companyId) return null
  const { data, error } = await service
    .from(table)
    .select("id, company_id")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle()
  if (error || !data) return null
  // Belt and braces: a query builder that ignored a filter must not pass.
  if (data.id !== id || data.company_id !== companyId) return null
  return data.id
}

/** All of `ids` belong to companyId. An empty list is true; any bad id is false. */
export async function allOwned(
  service: any,
  table: OwnedTable,
  ids: unknown[],
  companyId: string | null | undefined,
): Promise<boolean> {
  if (!companyId) return false
  if (!ids.every(isUuid)) return false
  const unique = [...new Set(ids as string[])]
  if (unique.length === 0) return true
  const { data, error } = await service
    .from(table)
    .select("id, company_id")
    .in("id", unique)
    .eq("company_id", companyId)
  if (error || !data) return false
  const found = new Set((data as any[]).filter(r => r.company_id === companyId).map(r => r.id))
  return unique.every(id => found.has(id))
}
