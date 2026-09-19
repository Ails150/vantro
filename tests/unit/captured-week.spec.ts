import { test, expect } from "@playwright/test"
import { buildCapturedWeekEmail, capturedWeekLines, hoursText, isEmptyWeek, weekLabel, type CapturedWeek } from "../../lib/captured-week"

/**
 * The Friday email, pinned. Four counts and the TODAY sentence, word for word.
 */

const week: CapturedWeek = {
  companyName: "Holts Installations",
  weekStart: "2026-09-14",
  photos: 23,
  diaryEntries: 9,
  variationsRaised: 3,
  dayworksRaised: 1,
  hoursLogged: 142.46,
  uncaptured: { pence: 109030 },
}

test("the worked example", () => {
  const email = buildCapturedWeekEmail(week)
  expect(email.subject).toBe("Holts Installations: what you captured this week, 14 Sept to 20 Sept")
  expect(email.lines).toEqual([
    "23 photos taken",
    "9 diary entries",
    "4 variations raised (3 variations, 1 daywork)",
    "142.5 hours logged",
  ])
  // The same sentence the TODAY board prints.
  expect(email.sentence).toBe("£1,090.30 captured this month is not on a payment application yet.")
  expect(email.text).toContain("- 23 photos taken")
  expect(email.html).toContain("£1,090.30 captured this month")
  expect(email.html).toContain("/admin?tab=variations")
})

test("singulars read as singulars", () => {
  const lines = capturedWeekLines({ ...week, photos: 1, diaryEntries: 1, variationsRaised: 0, dayworksRaised: 1, hoursLogged: 1 })
  expect(lines).toEqual(["1 photo taken", "1 diary entry", "1 variation raised (1 daywork)", "1 hour logged"])
})

test("nothing owed says so", () => {
  expect(buildCapturedWeekEmail({ ...week, uncaptured: { pence: 0 } }).sentence)
    .toBe("Everything captured this month is on a payment application.")
})

test("an empty week is not sent by the cron", () => {
  const empty = { ...week, photos: 0, diaryEntries: 0, variationsRaised: 0, dayworksRaised: 0, hoursLogged: 0, uncaptured: { pence: 0 } }
  expect(isEmptyWeek(empty)).toBe(true)
  // Money outstanding alone is worth the email.
  expect(isEmptyWeek({ ...empty, uncaptured: { pence: 1 } })).toBe(false)
})

test("a company name cannot make the subject unsendable, or inject markup", () => {
  const email = buildCapturedWeekEmail({ ...week, companyName: "<b>x</b>".repeat(100000) })
  expect(email.subject.length).toBeLessThan(200)
  expect(email.html).not.toContain("<b>x</b>")
})

test("hours and week labels", () => {
  expect(hoursText(0)).toBe("0 hours")
  expect(hoursText(37.25)).toBe("37.3 hours")
  expect(weekLabel("2026-10-26")).toBe("26 Oct to 1 Nov")
})

test("hours logged are the weekly report's hours: stored hours first, else signed out minus signed in", async () => {
  // The same summariseWeek the free plan's Friday PDF uses. Open shifts count
  // for nothing rather than for the hours so far.
  const { summariseWeek } = await import("../../lib/weekly-report")
  const shifts = [
    { user_id: "u1", job_id: "j1", signed_in_at: "2026-09-14T07:00:00Z", signed_out_at: "2026-09-14T15:30:00Z", hours_worked: 8.25 },
    { user_id: "u2", job_id: "j1", signed_in_at: "2026-09-15T07:00:00Z", signed_out_at: "2026-09-15T16:06:00Z", hours_worked: null },
    { user_id: "u2", job_id: "j1", signed_in_at: "2026-09-16T07:00:00Z", signed_out_at: null, hours_worked: null },
  ]
  const hours = summariseWeek("Holts", "2026-09-14", shifts, null).totalHours
  expect(hours).toBeCloseTo(8.25 + 9.1, 6)
  expect(capturedWeekLines({ ...week, hoursLogged: hours })[3]).toBe("17.4 hours logged")
})
