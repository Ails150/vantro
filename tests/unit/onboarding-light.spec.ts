import { test, expect } from "@playwright/test"
import { shouldAutoAssign } from "../../lib/auto-assign"
import { canHoldPin, mayHoldPin, FIELD_ROLE } from "../../lib/roles"

/**
 * The rules behind a lighter first run. Both of these decide something a
 * customer feels immediately -- whether their worker can log in, and whether
 * the job they just made is visible to anybody -- so they are pinned here
 * rather than left to be read off a route.
 */

test.describe("auto-assign: one job, one worker, nobody linked", () => {
  test("links the only possible pairing", () => {
    expect(shouldAutoAssign({ activeJobs: 1, workers: 1, existingAssignments: 0 })).toBe(true)
  })

  test("never guesses when there is a choice", () => {
    // Two jobs: which site does the one worker belong on? The office knows and
    // this does not, and a wrong guess hides work from the person doing it.
    expect(shouldAutoAssign({ activeJobs: 2, workers: 1, existingAssignments: 0 })).toBe(false)
    expect(shouldAutoAssign({ activeJobs: 1, workers: 2, existingAssignments: 0 })).toBe(false)
    expect(shouldAutoAssign({ activeJobs: 3, workers: 4, existingAssignments: 0 })).toBe(false)
  })

  test("keeps out of the way once anybody has assigned anything", () => {
    // An existing assignment means the office has started deciding. A company
    // that deliberately left its one worker off its one job gets to keep that.
    expect(shouldAutoAssign({ activeJobs: 1, workers: 1, existingAssignments: 1 })).toBe(false)
  })

  test("does nothing when either side is missing", () => {
    expect(shouldAutoAssign({ activeJobs: 0, workers: 1, existingAssignments: 0 })).toBe(false)
    expect(shouldAutoAssign({ activeJobs: 1, workers: 0, existingAssignments: 0 })).toBe(false)
    expect(shouldAutoAssign({ activeJobs: 0, workers: 0, existingAssignments: 0 })).toBe(false)
  })
})

test.describe("who may hold a PIN", () => {
  test("field roles, by role alone", () => {
    expect(mayHoldPin({ role: FIELD_ROLE })).toBe(true)
    expect(mayHoldPin({ role: "installer" })).toBe(true)
    expect(mayHoldPin({ role: "subcontractor" })).toBe(true)
    expect(mayHoldPin({ role: "foreman" })).toBe(true)
  })

  test("an office role, only when the owner has said they work on site", () => {
    expect(mayHoldPin({ role: "admin" })).toBe(false)
    expect(mayHoldPin({ role: "admin", works_on_site: false })).toBe(false)
    expect(mayHoldPin({ role: "admin", works_on_site: true })).toBe(true)
    expect(mayHoldPin({ role: "superadmin", works_on_site: true })).toBe(true)
  })

  test("the flag is a decision, not an inference", () => {
    // canHoldPin still answers the question by role alone, and the flag is the
    // only thing that widens it. Nothing here reads pin_hash: an account with
    // no PIN permanently satisfies "has no PIN yet", which is how anybody who
    // knew an admin's address could put one on their account.
    expect(canHoldPin("admin")).toBe(false)
    expect(mayHoldPin(null)).toBe(false)
    expect(mayHoldPin(undefined)).toBe(false)
    expect(mayHoldPin({ role: null, works_on_site: true })).toBe(true)
    expect(mayHoldPin({ role: "admin", works_on_site: null })).toBe(false)
  })
})

test.describe("the company name signup no longer asks for", () => {
  test("a business domain becomes the business", async () => {
    const { companyNameFromEmail } = await import("../../lib/provisioning")
    expect(companyNameFromEmail("dan@barrow-glazing.co.uk")).toBe("Barrow Glazing")
    expect(companyNameFromEmail("dan@barrowglazing.co.uk")).toBe("Barrowglazing")
    expect(companyNameFromEmail("office@kestrel.construction")).toBe("Kestrel")
  })

  test("a public mailbox falls back to the person, never 'Gmail'", async () => {
    const { companyNameFromEmail } = await import("../../lib/provisioning")
    expect(companyNameFromEmail("dan.mercer@gmail.com")).toBe("Dan Mercer")
    expect(companyNameFromEmail("dan_mercer@hotmail.co.uk")).toBe("Dan Mercer")
  })

  test("nonsense in, something usable out", async () => {
    const { companyNameFromEmail } = await import("../../lib/provisioning")
    expect(companyNameFromEmail("")).toBe("My company")
    expect(companyNameFromEmail("@nothing.com")).toBe("My company")
    expect(companyNameFromEmail("nodomain")).toBe("My company")
  })
})
