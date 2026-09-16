import { test, expect } from "@playwright/test"
import fs from "fs"
import path from "path"
import {
  DPA_URL, DPA_VERSION, PRIVACY_URL, TERMS_URL, TERMS_VERSION,
  acceptanceColumns, acceptanceState,
} from "../../lib/legal"

/**
 * What the signup checkbox records, and what it must never record.
 *
 * An acceptance record is only worth anything if it can answer three questions
 * years later: who agreed, when, and to WHICH VERSION of what. Drop any one and
 * it stops being evidence. Most of what follows is about making the third one
 * impossible to lose.
 */

const ROOT = path.resolve(__dirname, "..", "..")

test.describe("acceptanceColumns", () => {
  test("stamps both documents at the same instant", () => {
    const at = new Date("2026-09-16T11:22:33.000Z")
    const cols = acceptanceColumns("Jo Bannon", at)
    expect(cols.terms_accepted_at).toBe("2026-09-16T11:22:33.000Z")
    expect(cols.dpa_accepted_at).toBe("2026-09-16T11:22:33.000Z")
    // One checkbox, one moment. Two timestamps a few milliseconds apart would
    // imply two separate acts of agreement, which is not what happened.
    expect(cols.terms_accepted_at).toBe(cols.dpa_accepted_at)
  })

  test("records the version of each document", () => {
    const cols = acceptanceColumns("Jo Bannon")
    expect(cols.terms_version).toBe(TERMS_VERSION)
    expect(cols.dpa_version).toBe(DPA_VERSION)
  })

  test("keeps the two versions in separate columns", () => {
    // They will diverge. The moment the terms go to 1.1 and the DPA stays at
    // 1.0, a shared column cannot say what the company agreed to.
    const cols = acceptanceColumns("Jo Bannon") as Record<string, string>
    expect(Object.keys(cols)).toContain("terms_version")
    expect(Object.keys(cols)).toContain("dpa_version")
  })

  test("stores the name as a value, not only as a reference", () => {
    // The user row can be renamed, deactivated, or anonymised by a GDPR
    // erasure. The acceptance has to survive all three and still say who.
    const cols = acceptanceColumns("Marcus Webb")
    expect(cols.terms_accepted_by_name).toBe("Marcus Webb")
    expect(cols.dpa_accepted_by_name).toBe("Marcus Webb")
  })

  test("never writes an empty name", () => {
    // "" accepted the terms is not a record anybody can use.
    expect(acceptanceColumns("").terms_accepted_by_name).toBe("Admin")
    expect(acceptanceColumns("   ").dpa_accepted_by_name).toBe("Admin")
  })

  test("trims, because the name came out of a form", () => {
    expect(acceptanceColumns("  Priya Shah \n").terms_accepted_by_name).toBe("Priya Shah")
  })

  test("uses the moment it is given, not the moment it runs", () => {
    // The paid path provisions the company in a Stripe webhook minutes after
    // the person ticked the box. Stamping "now" there would record when Stripe
    // called us, which is a worse answer to give a court than none.
    const then = new Date("2026-01-01T00:00:00.000Z")
    expect(acceptanceColumns("Jo", then).terms_accepted_at).toBe("2026-01-01T00:00:00.000Z")
  })
})

test.describe("acceptanceState", () => {
  test("missing and outdated are different answers", () => {
    // One company never agreed to anything. The other agreed to something we
    // have since changed. Telling an admin the same thing in both cases makes
    // one of the two messages wrong.
    expect(acceptanceState(null, null, "1.0")).toBe("missing")
    expect(acceptanceState("2026-01-01T00:00:00Z", "0.9", "1.0")).toBe("outdated")
    expect(acceptanceState("2026-01-01T00:00:00Z", "1.0", "1.0")).toBe("current")
  })

  test("a timestamp with no version counts as outdated, not missing", () => {
    // Somebody accepted SOMETHING before versions were recorded. Calling that
    // "never accepted" throws away a true fact.
    expect(acceptanceState("2026-01-01T00:00:00Z", null, "1.0")).toBe("outdated")
  })

  test("an empty string is not a timestamp", () => {
    expect(acceptanceState("", "1.0", "1.0")).toBe("missing")
  })
})

test.describe("the links the checkbox points at", () => {
  test("the DPA link is the document actually in force, not the redraft", () => {
    // docs/legal/dpa.md is a redraft marked "do not publish" and not reviewed
    // by a solicitor. Pointing a signup checkbox at it would make every
    // acceptance a record of agreeing to a draft.
    expect(DPA_URL).not.toContain("docs/")
    expect(fs.existsSync(path.join(ROOT, "public", DPA_URL.replace(/^\//, "")))).toBe(true)
  })

  test("the terms link resolves to a page that exists", () => {
    expect(TERMS_URL).toBe("/legal/terms")
    expect(fs.existsSync(path.join(ROOT, "app", "legal", "terms", "page.tsx"))).toBe(true)
  })

  test("the privacy link resolves to a page that exists", () => {
    expect(fs.existsSync(path.join(ROOT, "app", PRIVACY_URL.replace(/^\//, ""), "page.tsx"))).toBe(true)
  })
})

test.describe("the signup page", () => {
  const src = fs.readFileSync(path.join(ROOT, "app", "signup", "page.tsx"), "utf8")

  test("starts unticked", () => {
    // A pre-ticked box is not agreement -- UK GDPR recital 32 -- and a signup
    // that pre-ticks it has produced a worthless record at the exact moment it
    // was trying to produce a valuable one.
    expect(src).toMatch(/useState\(false\)/)
    expect(src).not.toMatch(/accepted.*useState\(true\)/)
  })

  test("the submit button is disabled until it is ticked", () => {
    expect(src).toMatch(/disabled=\{loading \|\| !accepted\}/)
  })

  test("links all three documents", () => {
    expect(src).toContain("TERMS_URL")
    expect(src).toContain("DPA_URL")
    expect(src).toContain("PRIVACY_URL")
  })
})

test.describe("the server does not trust the browser", () => {
  const src = fs.readFileSync(
    path.join(ROOT, "app", "api", "signup", "initiate", "route.ts"), "utf8",
  )

  test("the route refuses a signup without acceptance", () => {
    // A disabled submit button is a courtesy to somebody filling in a form.
    // Anybody posting to the route directly has bypassed it without trying.
    expect(src).toMatch(/acceptedTerms !== true/)
  })

  test("it demands true, not merely truthy", () => {
    // "false" is a truthy string. 1 is truthy. Neither is somebody ticking a
    // box, and both mean something built this request.
    expect(src).not.toMatch(/if \(!acceptedTerms\)/)
    expect(src).toMatch(/!== true/)
  })

  test("the free company is stamped in the same insert that creates it", () => {
    // A follow-up update can fail and leave a company that exists with no
    // record of having agreed to anything -- the one outcome this is for.
    const insert = src.slice(src.indexOf(".from('companies')"), src.indexOf(".select('id')"))
    expect(insert).toContain("acceptanceColumns")
  })

  test("the paid path carries the moment of acceptance to the webhook", () => {
    expect(src).toContain("accepted_terms_at")
    expect(src).toContain("accepted_terms_by")
  })
})

test.describe("the billing webhook", () => {
  const src = fs.readFileSync(
    path.join(ROOT, "app", "api", "billing", "webhook", "route.ts"), "utf8",
  )

  test("uses the acceptance time from the checkout, not its own clock", () => {
    expect(src).toContain("meta.accepted_terms_at")
    // The tell for the bug: acceptanceColumns called with no date, or with a
    // fresh one, inside the webhook.
    expect(src).not.toMatch(/acceptanceColumns\([^)]*new Date\(\)\)/)
  })

  test("still provisions a company whose checkout carried no acceptance", () => {
    // Refusing to create a company somebody has paid for, because of a missing
    // metadata key, is the wrong failure. The columns stay null and the gap is
    // visible instead.
    expect(src).toMatch(/\?\s*acceptanceColumns\([\s\S]{0,120}\)\s*:\s*\{\}/)
  })
})

test.describe("nothing hard-codes a version any more", () => {
  test("the accept-dpa route takes it from lib/legal", () => {
    // It used to type "1.0" into the update. That works right up until the
    // documents are reissued, at which point three of the four places that
    // record a version have moved and one has not.
    const src = fs.readFileSync(
      path.join(ROOT, "app", "api", "account", "accept-dpa", "route.ts"), "utf8",
    )
    expect(src).toContain("acceptanceColumns")
    expect(src).not.toMatch(/dpa_version:\s*["']1\.0["']/)
  })
})

test.describe("the migration", () => {
  const sql = fs.readFileSync(
    path.join(ROOT, "supabase", "migrations", "20260916150000_terms_acceptance.sql"), "utf8",
  )

  test("adds the three terms columns and touches no DPA column", () => {
    expect(sql).toContain("terms_accepted_at")
    expect(sql).toContain("terms_accepted_by_name")
    expect(sql).toContain("terms_version")
    // The instruction was to reuse the existing DPA columns rather than build
    // beside them. Adding a second set would be exactly that.
    expect(sql).not.toMatch(/add column if not exists dpa_/)
  })

  test("does not backfill existing companies", () => {
    // A consent record invented by a migration is worse than no record,
    // because it looks like evidence.
    expect(sql).not.toMatch(/update\s+public\.companies\s+set\s+terms_accepted_at/i)
  })

  test("stores no IP address", () => {
    // Personal data that would have to be justified, disclosed and erased on
    // request, in exchange for almost nothing the name and timestamp do not
    // already give.
    expect(sql).not.toContain("terms_accepted_ip")
  })
})
