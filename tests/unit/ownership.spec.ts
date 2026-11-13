import { test, expect } from "@playwright/test"
import { allOwned, ownedId } from "../../lib/ownership"

const A = "11111111-1111-4111-8111-111111111111"
const B = "22222222-2222-4222-8222-222222222222"
const T_A = "aaaaaaaa-0000-4000-8000-000000000001"
const T_B = "bbbbbbbb-0000-4000-8000-000000000002"

/** A fake that honours eq() and in() filters, so a missing company filter is caught. */
function fake(rows: Array<{ id: string; company_id: string }>) {
  const calls: string[] = []
  return {
    calls,
    from(table: string) {
      const eqs: Record<string, string> = {}
      let ins: string[] | null = null
      const run = () => rows.filter(r =>
        Object.entries(eqs).every(([k, v]) => (r as any)[k] === v) && (!ins || ins.includes(r.id)))
      const q: any = {
        select: () => q,
        eq: (c: string, v: string) => { eqs[c] = v; calls.push(`${table}.eq.${c}`); return q },
        in: (_c: string, v: string[]) => { ins = v; return q },
        maybeSingle: async () => ({ data: run()[0] || null, error: null }),
        then: (r: any) => r({ data: run(), error: null }),
      }
      return q
    },
  }
}

const rows = [{ id: T_A, company_id: A }, { id: T_B, company_id: B }]

test.describe("ownedId", () => {
  test("own row passes, other company's row and garbage do not", async () => {
    expect(await ownedId(fake(rows), "checklist_templates", T_A, A)).toBe(T_A)
    expect(await ownedId(fake(rows), "checklist_templates", T_B, A)).toBeNull()
    for (const bad of [undefined, null, "", "x", 1, [T_A], { id: T_A }]) {
      expect(await ownedId(fake(rows), "checklist_templates", bad, A)).toBeNull()
    }
    expect(await ownedId(fake(rows), "checklist_templates", T_A, null)).toBeNull()
  })

  test("filters by company in the query", async () => {
    const s = fake(rows)
    await ownedId(s, "checklist_items", T_A, A)
    expect(s.calls).toContain("checklist_items.eq.company_id")
  })

  test("a leaky query builder still cannot pass another company's row", async () => {
    const leaky = { from: () => { const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: rows[1], error: null }) }; return q } }
    expect(await ownedId(leaky, "jobs", T_A, A)).toBeNull()
  })
})

test.describe("allOwned", () => {
  test("all own ids pass; one foreign or bad id fails the lot", async () => {
    expect(await allOwned(fake(rows), "jobs", [T_A, T_A], A)).toBe(true)
    expect(await allOwned(fake(rows), "jobs", [], A)).toBe(true)
    expect(await allOwned(fake(rows), "jobs", [T_A, T_B], A)).toBe(false)
    expect(await allOwned(fake(rows), "jobs", [T_A, "nope"], A)).toBe(false)
    expect(await allOwned(fake(rows), "jobs", [T_A], null)).toBe(false)
  })
})
