import { test, expect } from "@playwright/test"
import {
  ERASURE_CAVEATS,
  IDENTITY_COLUMNS,
  SUBJECT_TABLES,
  anonymisePatch,
  pseudonymFor,
  tablesToDelete,
  tablesToDetach,
  tablesToExport,
} from "../../lib/gdpr"

/**
 * An export that misses a table is an incomplete Article 15 response. An
 * anonymisation that misses one leaves a name behind after somebody was told it
 * had gone. Both are worse than not offering the feature at all.
 */

test.describe("the subject table map", () => {
  test("every entry is fully specified", () => {
    for (const t of SUBJECT_TABLES) {
      expect(t.table, JSON.stringify(t)).toMatch(/^[a-z_]+$/)
      expect(t.column, t.table).toMatch(/^[a-z_]+$/)
      expect(t.label.length, t.table).toBeGreaterThan(3)
      expect(["keep", "detach", "delete"]).toContain(t.anonymise)
    }
  })

  test("labels are written for the worker, not for the schema", () => {
    // Somebody reading their own data should not have to know that "signins"
    // means the times they started and finished work.
    for (const t of SUBJECT_TABLES) {
      expect(t.label).not.toBe(t.table)
      expect(t.label).not.toMatch(/_/)
    }
  })

  test("no duplicate table and column pair", () => {
    const seen = SUBJECT_TABLES.map(t => `${t.table}.${t.column}`)
    expect(new Set(seen).size).toBe(seen.length)
  })

  test("the evidence tables are KEPT, never deleted", () => {
    // These prove a site was manned and briefed, which is a fact about the
    // company as well as the person. Article 17(3).
    const mustKeep = [
      "signins", "location_logs", "rams_signatures",
      "toolbox_talk_signatures", "qa_submissions", "incidents",
    ]
    for (const table of mustKeep) {
      const entries = SUBJECT_TABLES.filter(t => t.table === table)
      expect(entries.length, table).toBeGreaterThan(0)
      // The subject's OWN column on an evidence table is kept.
      const own = entries.find(t => ["user_id", "reported_by"].includes(t.column))
      expect(own, table).toBeTruthy()
      expect(own!.anonymise, table).toBe("keep")
    }
  })

  test("every keep and detach entry carries the row, so nothing evidential vanishes", () => {
    const deleted = tablesToDelete().map(t => t.table)
    for (const table of ["signins", "rams_signatures", "qa_submissions", "expenses"]) {
      expect(deleted, table).not.toContain(table)
    }
  })

  test("a column that is this person acting on somebody else is detached, not deleted", () => {
    // Deleting the row would destroy the OTHER party's record.
    for (const col of ["reviewed_by", "acknowledged_by", "closed_by"]) {
      const entry = SUBJECT_TABLES.find(t => t.column === col)
      expect(entry, col).toBeTruthy()
      expect(entry!.anonymise, col).toBe("detach")
    }
  })

  test("export covers every table, whatever erasure does with it", () => {
    expect(tablesToExport()).toHaveLength(SUBJECT_TABLES.length)
    const kinds = new Set(tablesToExport().map(t => t.anonymise))
    expect(kinds.has("keep")).toBe(true)
    expect(kinds.has("delete")).toBe(true)
    expect(kinds.has("detach")).toBe(true)
  })

  test("the three buckets partition the map exactly", () => {
    const keep = SUBJECT_TABLES.filter(t => t.anonymise === "keep").length
    expect(keep + tablesToDelete().length + tablesToDetach().length).toBe(SUBJECT_TABLES.length)
  })
})

test.describe("pseudonymFor", () => {
  test("is stable for the same id", () => {
    const id = "4f2a9c11-1111-2222-3333-444455556666"
    expect(pseudonymFor(id)).toBe(pseudonymFor(id))
  })

  test("differs between people", () => {
    expect(pseudonymFor("aaaaaaaa-1111-2222-3333-444455556666"))
      .not.toBe(pseudonymFor("bbbbbbbb-1111-2222-3333-444455556666"))
  })

  test("says what an admin needs to understand", () => {
    expect(pseudonymFor("4f2a9c11-1111-2222-3333-444455556666")).toMatch(/^Former worker /)
  })

  test("carries nothing about who they were", () => {
    const p = pseudonymFor("4f2a9c11-1111-2222-3333-444455556666")
    expect(p.toLowerCase()).not.toContain("marek")
    expect(p).toMatch(/^Former worker [0-9A-F]{6}$/)
  })

  test("a missing id does not produce a broken label", () => {
    expect(pseudonymFor("")).toBe("Former worker UNKNOWN")
    expect(pseudonymFor(undefined as any)).toBe("Former worker UNKNOWN")
  })
})

test.describe("anonymisePatch", () => {
  const id = "4f2a9c11-1111-2222-3333-444455556666"

  test("removes every credential", () => {
    const patch = anonymisePatch(id, null) as any
    // A PIN left behind is a live credential belonging to somebody who asked to
    // be forgotten. The database enforces this too.
    expect(patch.pin_hash).toBeNull()
    expect(patch.auth_user_id).toBeNull()
    expect(patch.is_active).toBe(false)
  })

  test("removes the contact details", () => {
    const patch = anonymisePatch(id, null) as any
    expect(patch.email).toBeNull()
    expect(patch.phone).toBeNull()
  })

  test("replaces rather than blanks the name", () => {
    // A blank name renders as an empty row in every list in the product.
    const patch = anonymisePatch(id, null) as any
    expect(patch.name).toBe(pseudonymFor(id))
    expect(patch.initials).toBe("--")
  })

  test("stamps when and by whom", () => {
    const patch = anonymisePatch(id, "admin-id") as any
    expect(patch.anonymised_by).toBe("admin-id")
    expect(Date.parse(patch.anonymised_at)).toBeGreaterThan(0)
  })

  test("the identity column list covers everything the patch clears", () => {
    const patch = anonymisePatch(id, null) as any
    for (const col of ["name", "email", "phone", "initials", "pin_hash", "auth_user_id"]) {
      expect(IDENTITY_COLUMNS).toContain(col as any)
      expect(Object.keys(patch)).toContain(col)
    }
  })
})

test.describe("the caveats are stated, not buried", () => {
  test("the signed-pack limit is named explicitly", () => {
    const joined = ERASURE_CAVEATS.join(" ").toLowerCase()
    expect(joined).toContain("audit pack")
    expect(joined).toContain("signature")
  })

  test("the legal basis for keeping evidence is named", () => {
    expect(ERASURE_CAVEATS.join(" ")).toContain("17(3)")
  })

  test("backups are mentioned, because people ask", () => {
    expect(ERASURE_CAVEATS.join(" ").toLowerCase()).toContain("backup")
  })
})
