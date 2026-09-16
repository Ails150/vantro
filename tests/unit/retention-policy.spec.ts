import { test, expect } from "@playwright/test"
import {
  PURGE_TABLES,
  RETENTION_GRACE_DAYS,
  RETENTION_OPTIONS,
  SIX_YEARS,
  THREE_YEARS,
  isValidRetentionDays,
  retentionLabel,
  retentionState,
} from "../../lib/retention-policy"

/**
 * This decides when records are destroyed permanently. Every boundary is pinned
 * here, and the default is asserted first: a company that has chosen nothing
 * must lose nothing.
 */

const NOW = new Date("2026-09-16T12:00:00Z")
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000)

test.describe("keep for ever is the default and destroys nothing", () => {
  test("no policy means nothing is ever purged", () => {
    const s = retentionState(null, null, NOW)
    expect(s.active).toBe(false)
    expect(s.cutoff).toBeNull()
    expect(s.firstPurgeAt).toBeNull()
    expect(s.warn).toBe(false)
  })

  test("undefined, zero and rubbish all mean for ever", () => {
    for (const v of [undefined, 0, -100, NaN, "nonsense" as any]) {
      const s = retentionState(v as any, daysAgo(400), NOW)
      expect(s.active, String(v)).toBe(false)
      expect(s.cutoff, String(v)).toBeNull()
    }
  })

  test("for ever is the first option offered", () => {
    expect(RETENTION_OPTIONS[0].days).toBeNull()
  })
})

test.describe("the thirty day grace", () => {
  test("a policy set today purges nothing yet", () => {
    const s = retentionState(THREE_YEARS, NOW, NOW)
    expect(s.active).toBe(false)
    expect(s.warn).toBe(true)
    expect(s.daysUntilFirstPurge).toBe(RETENTION_GRACE_DAYS)
  })

  test("the day before the grace expires, still nothing", () => {
    const s = retentionState(THREE_YEARS, daysAgo(29), NOW)
    expect(s.active).toBe(false)
    expect(s.warn).toBe(true)
    expect(s.daysUntilFirstPurge).toBe(1)
  })

  test("on the thirtieth day it becomes active and the banner stops", () => {
    const s = retentionState(THREE_YEARS, daysAgo(30), NOW)
    expect(s.active).toBe(true)
    expect(s.warn).toBe(false)
  })

  test("long after, it stays active", () => {
    const s = retentionState(THREE_YEARS, daysAgo(400), NOW)
    expect(s.active).toBe(true)
    expect(s.warn).toBe(false)
    expect(s.daysUntilFirstPurge).toBeLessThan(0)
  })

  test("changing the policy restarts the countdown", () => {
    // Set long ago, then changed today: the new choice gets its own grace.
    const fresh = retentionState(SIX_YEARS, NOW, NOW)
    expect(fresh.active).toBe(false)
    expect(fresh.daysUntilFirstPurge).toBe(RETENTION_GRACE_DAYS)
  })
})

test.describe("a policy with no timestamp never purges", () => {
  test("null setAt is not treated as due immediately", () => {
    // A hand edit or an import could leave the stamp missing. Deleting records
    // because a timestamp was absent is the wrong way to resolve that.
    const s = retentionState(THREE_YEARS, null, NOW)
    expect(s.active).toBe(false)
    expect(s.firstPurgeAt).toBeNull()
    expect(s.daysUntilFirstPurge).toBeNull()
    expect(s.warn).toBe(false)
  })

  test("an unparseable timestamp is treated the same way", () => {
    const s = retentionState(THREE_YEARS, "not a date", NOW)
    expect(s.active).toBe(false)
    expect(s.firstPurgeAt).toBeNull()
  })
})

test.describe("the cutoff", () => {
  test("three years back, to the day", () => {
    const s = retentionState(THREE_YEARS, daysAgo(60), NOW)
    const expected = new Date(NOW.getTime() - THREE_YEARS * 86400000)
    expect(s.cutoff!.toISOString()).toBe(expected.toISOString())
  })

  test("six years is twice three, near enough a day", () => {
    expect(SIX_YEARS).toBe(2190)
    expect(THREE_YEARS).toBe(1095)
  })

  test("a cutoff exists even during the grace, so the banner can say what goes", () => {
    const s = retentionState(THREE_YEARS, NOW, NOW)
    expect(s.active).toBe(false)
    expect(s.cutoff).not.toBeNull()
  })
})

test.describe("isValidRetentionDays", () => {
  test("accepts the three options", () => {
    expect(isValidRetentionDays(null)).toBe(true)
    expect(isValidRetentionDays("")).toBe(true)
    expect(isValidRetentionDays(THREE_YEARS)).toBe(true)
    expect(isValidRetentionDays(SIX_YEARS)).toBe(true)
  })

  test("refuses anything that would erase a company overnight", () => {
    expect(isValidRetentionDays(1)).toBe(false)
    expect(isValidRetentionDays(0)).toBe(false)
    expect(isValidRetentionDays(-30)).toBe(false)
    expect(isValidRetentionDays(29)).toBe(false)
  })

  test("refuses non-integers and nonsense", () => {
    expect(isValidRetentionDays(1095.5)).toBe(false)
    expect(isValidRetentionDays("three years")).toBe(false)
    expect(isValidRetentionDays(999999)).toBe(false)
  })
})

test.describe("retentionLabel", () => {
  test("names the three options", () => {
    expect(retentionLabel(null)).toBe("Keep for ever")
    expect(retentionLabel(THREE_YEARS)).toBe("3 years")
    expect(retentionLabel(SIX_YEARS)).toBe("6 years")
  })

  test("a hand-set value is described rather than mislabelled", () => {
    expect(retentionLabel(365)).toBe("1 years")
    expect(retentionLabel(90)).toBe("90 days")
  })
})

test.describe("the purge table list", () => {
  test("covers the event tables", () => {
    const tables = PURGE_TABLES.map(t => t.table)
    for (const expected of [
      "signins", "location_logs", "diary_entries", "qa_submissions",
      "defects", "incidents", "rams_signatures", "toolbox_talk_signatures",
    ]) {
      expect(tables, expected).toContain(expected)
    }
  })

  test("NEVER sweeps the integrity chain or the records of what it did", () => {
    // An audit pack issued to a client must stay verifiable, and the purge log
    // is the only surviving account of what a purge destroyed.
    const tables = PURGE_TABLES.map(t => t.table)
    for (const forbidden of [
      "audit_packs", "evidence_hashes", "retention_purges",
      "data_subject_requests", "users", "companies", "jobs", "sites",
      "pay_rules", "pay_bonuses",
    ]) {
      expect(tables, forbidden).not.toContain(forbidden)
    }
  })

  test("every entry names a timestamp column", () => {
    for (const t of PURGE_TABLES) {
      expect(t.column, t.table).toMatch(/_at$/)
    }
  })

  test("no duplicates", () => {
    const tables = PURGE_TABLES.map(t => t.table)
    expect(new Set(tables).size).toBe(tables.length)
  })
})
