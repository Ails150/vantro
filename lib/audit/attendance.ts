// lib/audit/attendance.ts
//
// How a shift reads in the attendance table of an evidence pack.
//
// The pack printed an em dash in the sign-out and hours columns for any shift
// that was not closed, and for any closed shift whose stored hours rounded to
// zero. A dash says "no data" about a shift that is either still running or
// genuinely very short, and this document is read by somebody deciding whether
// to pay for the work: "—" where a number should be is the kind of gap a
// quantity surveyor treats as the whole row being unreliable.
//
// So a shift in progress says so, and a real but tiny shift says how tiny
// rather than nothing at all. Nothing here invents a figure: a shift with no
// sign-out has no duration, and this prints that fact in words.

export type AttendanceInput = {
  signed_in_at?: string | null
  signed_out_at?: string | null
  hours_worked?: number | string | null
}

export type AttendanceCells = {
  /** What goes in the "Signed out" column. */
  signedOut: string
  /** What goes in the "Hours" column. */
  hours: string
  /** True when the shift has not been closed. Lets the renderer style it. */
  inProgress: boolean
}

/** Hours between the two stamps, or null if they cannot be read. */
export function elapsedHours(input: AttendanceInput): number | null {
  if (!input.signed_in_at || !input.signed_out_at) return null
  const inAt = new Date(input.signed_in_at).getTime()
  const outAt = new Date(input.signed_out_at).getTime()
  if (!Number.isFinite(inAt) || !Number.isFinite(outAt)) return null
  const hours = (outAt - inAt) / 3_600_000
  return hours >= 0 ? hours : null
}

export function attendanceCells(input: AttendanceInput, formatTime: (v: string) => string): AttendanceCells {
  if (!input.signed_out_at) {
    // Still on site, or the shift was never closed. Either way the pack must
    // not imply a duration it does not have.
    return { signedOut: "In progress", hours: "In progress", inProgress: true }
  }

  const stored = input.hours_worked === null || input.hours_worked === undefined || input.hours_worked === ""
    ? null
    : Number(input.hours_worked)
  const computed = elapsedHours(input)
  // Stored hours first -- payroll may have corrected them -- but a stored zero
  // on a shift that plainly ran is not a correction, it is a missing value.
  const hours = stored !== null && Number.isFinite(stored) && stored > 0 ? stored : computed

  if (hours === null || !Number.isFinite(hours)) {
    return { signedOut: formatTime(input.signed_out_at), hours: "Not recorded", inProgress: false }
  }
  // A shift shorter than six minutes rounds to 0.0h, which reads as "nothing
  // happened". It did happen, briefly, and the times above say when.
  const text = hours > 0 && hours < 0.05 ? "under 0.1h" : `${hours.toFixed(1)}h`
  return { signedOut: formatTime(input.signed_out_at), hours: text, inProgress: false }
}
