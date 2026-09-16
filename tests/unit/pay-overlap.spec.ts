import { test, expect } from "@playwright/test"
import { allocateShifts, hasOverlap } from "../../lib/pay"

/**
 * This was found paying somebody twice: a surveyor signed into three sites at
 * once, 26.30 hours on one Monday, straight onto a Xero timesheet. A minute may
 * only be paid once.
 */

const at = (h: number, m = 0) => Date.UTC(2026, 8, 7, h, m)
const shift = (id: string, from: [number, number], to: [number, number]) => ({
  id, start: at(...from), end: at(...to),
})

test.describe("no overlap: nothing changes", () => {
  test("a single shift is paid in full", () => {
    const a = allocateShifts([shift("a", [9, 0], [17, 30])])
    expect(a.totalHours).toBe(8.5)
    expect(a.hoursById.get("a")).toBe(8.5)
    expect(a.trimmedIds.size).toBe(0)
    expect(a.trimmedHours).toBe(0)
  })

  test("consecutive shifts are both paid in full", () => {
    const a = allocateShifts([shift("a", [8, 0], [12, 0]), shift("b", [13, 0], [17, 0])])
    expect(a.totalHours).toBe(8)
    expect(a.trimmedIds.size).toBe(0)
  })

  test("touching shifts do not count as overlapping", () => {
    // Ending at 12:00 and starting at 12:00 share no minute.
    const a = allocateShifts([shift("a", [8, 0], [12, 0]), shift("b", [12, 0], [16, 0])])
    expect(a.totalHours).toBe(8)
    expect(a.trimmedIds.size).toBe(0)
    expect(hasOverlap([shift("a", [8, 0], [12, 0]), shift("b", [12, 0], [16, 0])])).toBe(false)
  })
})

test.describe("overlap: the earliest shift keeps the time", () => {
  test("a partial overlap trims the later shift", () => {
    const a = allocateShifts([shift("a", [9, 0], [17, 0]), shift("b", [15, 0], [19, 0])])
    expect(a.hoursById.get("a")).toBe(8)   // untouched
    expect(a.hoursById.get("b")).toBe(2)   // 17:00-19:00 only
    expect(a.totalHours).toBe(10)          // not 12
    expect([...a.trimmedIds]).toEqual(["b"])
    expect(a.trimmedHours).toBe(2)
  })

  test("the rule does not depend on which was longer or later-ending", () => {
    // b starts later but is longer. It still yields to a.
    const a = allocateShifts([shift("a", [9, 0], [11, 0]), shift("b", [10, 0], [20, 0])])
    expect(a.hoursById.get("a")).toBe(2)
    expect(a.hoursById.get("b")).toBe(9)
    expect(a.totalHours).toBe(11)
  })

  test("a shift wholly inside another is trimmed to nothing but still listed", () => {
    // A shift missing from the timesheet is indistinguishable from one nobody
    // recorded, so it appears at zero rather than vanishing.
    const a = allocateShifts([shift("a", [8, 0], [18, 0]), shift("b", [10, 0], [12, 0])])
    expect(a.hoursById.get("b")).toBe(0)
    expect(a.hoursById.has("b")).toBe(true)
    expect(a.totalHours).toBe(10)
    expect([...a.trimmedIds]).toEqual(["b"])
  })

  test("a contained shift does not reopen the window for a later one", () => {
    // The bug this guards: after processing the short inner shift, a naive
    // sweep would set the cursor back to 12:00 and pay c from 12:00 twice.
    const a = allocateShifts([
      shift("a", [8, 0], [18, 0]),
      shift("b", [10, 0], [12, 0]),
      shift("c", [13, 0], [20, 0]),
    ])
    expect(a.hoursById.get("a")).toBe(10)
    expect(a.hoursById.get("b")).toBe(0)
    expect(a.hoursById.get("c")).toBe(2)  // 18:00-20:00 only
    expect(a.totalHours).toBe(12)
  })

  test("three concurrent shifts, the case that was found in production data", () => {
    // Ellie Brandt, Monday 7 September: Ely 08:30-17:05, Cambridge 09:00-17:37,
    // Newmarket 09:00-18:06. Recorded as 26.30 hours.
    const a = allocateShifts([
      shift("ely", [8, 30], [17, 5]),
      shift("cam", [9, 0], [17, 37]),
      shift("nkt", [9, 0], [18, 6]),
    ])
    // 08:30 to 18:06 is 9h36m, and that is all anybody can have worked.
    expect(a.totalHours).toBe(9.6)
    expect(a.totalHours).toBeLessThan(24)
    expect(a.trimmedIds.size).toBe(2)
    expect(a.hoursById.get("ely")).toBeCloseTo(8.58, 2)
  })

  test("identical shifts pay once", () => {
    const a = allocateShifts([shift("a", [9, 0], [17, 0]), shift("b", [9, 0], [17, 0])])
    expect(a.totalHours).toBe(8)
    expect(a.hoursById.get("b")).toBe(0)
  })

  test("the result does not depend on input order", () => {
    const shifts = [
      shift("c", [13, 0], [20, 0]),
      shift("a", [8, 0], [18, 0]),
      shift("b", [10, 0], [12, 0]),
    ]
    const forward = allocateShifts(shifts)
    const reversed = allocateShifts([...shifts].reverse())
    expect(forward.totalHours).toBe(reversed.totalHours)
    expect(forward.hoursById.get("a")).toBe(reversed.hoursById.get("a"))
    expect(forward.hoursById.get("c")).toBe(reversed.hoursById.get("c"))
  })

  test("shifts starting and ending together are ordered deterministically by id", () => {
    // Without the id tiebreak the answer would depend on row order from the
    // database, and two runs of the same payroll could differ.
    const one = allocateShifts([shift("zzz", [9, 0], [17, 0]), shift("aaa", [9, 0], [17, 0])])
    const two = allocateShifts([shift("aaa", [9, 0], [17, 0]), shift("zzz", [9, 0], [17, 0])])
    expect(one.hoursById.get("aaa")).toBe(two.hoursById.get("aaa"))
    expect(one.hoursById.get("aaa")).toBe(8)
    expect(one.hoursById.get("zzz")).toBe(0)
  })
})

test.describe("bad input", () => {
  test("open, zero length and reversed shifts are ignored", () => {
    const a = allocateShifts([
      { id: "open", start: at(9), end: NaN },
      { id: "zero", start: at(9), end: at(9) },
      { id: "backwards", start: at(17), end: at(9) },
      shift("good", [9, 0], [17, 0]),
    ])
    expect(a.totalHours).toBe(8)
    expect(a.hoursById.has("open")).toBe(false)
    expect(a.hoursById.has("zero")).toBe(false)
  })

  test("an empty list is zero, not a crash", () => {
    const a = allocateShifts([])
    expect(a.totalHours).toBe(0)
    expect(a.trimmedHours).toBe(0)
    expect(() => allocateShifts(null as any)).not.toThrow()
  })
})

test.describe("hasOverlap", () => {
  test("detects and clears correctly", () => {
    expect(hasOverlap([shift("a", [9, 0], [17, 0]), shift("b", [16, 0], [18, 0])])).toBe(true)
    expect(hasOverlap([shift("a", [9, 0], [17, 0]), shift("b", [17, 0], [18, 0])])).toBe(false)
    expect(hasOverlap([shift("a", [9, 0], [17, 0])])).toBe(false)
    expect(hasOverlap([])).toBe(false)
  })
})
