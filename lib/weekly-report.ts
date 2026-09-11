// lib/weekly-report.ts
//
// The Friday report: what a free company's week actually looked like, as a PDF
// they can keep after we have deleted the rows behind it.
//
// That last part is the point. Free retention is five days, so by the middle
// of next week Monday's shifts are gone. A weekly PDF is the thing that makes
// that honest rather than lossy: the detail expires, the summary does not, and
// it lands in an inbox where it can be forwarded to an accountant.
//
// pdf-lib rather than a headless browser: the report is a fixed layout of text
// and rules, the base-14 fonts need no files on disk, and nothing here should
// require Chromium on a serverless function.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib"
import { addDays, formatIn, isoWeekStart, londonMidnight } from "./format-time"

// Brand ink and accent, matched to the admin UI.
const INK = rgb(0.043, 0.059, 0.078)
const MUTED = rgb(0.357, 0.4, 0.451)
const ACCENT = rgb(0, 0.474, 0.357)
const LINE = rgb(0.918, 0.925, 0.941)

const PAGE_W = 595.28 // A4 portrait, points
const PAGE_H = 841.89
const MARGIN = 56

export type WeeklyReportInput = {
  companyName: string
  weekStart: string // Monday, YYYY-MM-DD
  totalHours: number
  shiftCount: number
  peopleOnSite: number
  jobsWorked: number
  /** Hours per day, Monday first. */
  dailyHours: number[]
  /** Per person, already sorted, already trimmed to a sensible length. */
  perPerson: Array<{ name: string; hours: number; shifts: number }>
  retentionDays: number | null
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

/** Aggregate a week of signins into everything the PDF prints. */
export function summariseWeek(
  companyName: string,
  weekStart: string,
  signins: any[],
  retentionDays: number | null,
): WeeklyReportInput {
  const dailyHours = [0, 0, 0, 0, 0, 0, 0]
  const byPerson = new Map<string, { name: string; hours: number; shifts: number }>()
  const jobIds = new Set<string>()
  let totalHours = 0

  for (const s of signins) {
    const hours = hoursOf(s)
    totalHours += hours
    if (s.job_id) jobIds.add(s.job_id)

    const dayIndex = DAY_LABELS.indexOf(formatIn(s.signed_in_at, { weekday: "short" }))
    if (dayIndex >= 0) dailyHours[dayIndex] += hours

    const key = s.user_id
    const entry = byPerson.get(key) || { name: s.users?.name || "Unknown", hours: 0, shifts: 0 }
    entry.hours += hours
    entry.shifts += 1
    byPerson.set(key, entry)
  }

  return {
    companyName,
    weekStart,
    totalHours,
    shiftCount: signins.length,
    peopleOnSite: byPerson.size,
    jobsWorked: jobIds.size,
    dailyHours,
    perPerson: Array.from(byPerson.values()).sort((a, b) => b.hours - a.hours).slice(0, 20),
    retentionDays,
  }
}

function hoursOf(signin: any): number {
  if (signin.hours_worked != null) return Number(signin.hours_worked)
  if (signin.signed_in_at && signin.signed_out_at) {
    const ms = new Date(signin.signed_out_at).getTime() - new Date(signin.signed_in_at).getTime()
    return ms > 0 ? ms / 3600000 : 0
  }
  return 0
}

function h(n: number): string {
  return `${n.toFixed(1)}h`
}

export async function renderWeeklyReportPdf(input: WeeklyReportInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([PAGE_W, PAGE_H])
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  const weekEndLabel = formatIn(londonMidnight(addDays(input.weekStart, 6)), {
    day: "numeric", month: "long", year: "numeric",
  })
  const weekStartLabel = formatIn(londonMidnight(input.weekStart), { day: "numeric", month: "long" })

  let y = PAGE_H - MARGIN

  // ─── Header ──────────────────────────────────────────────────────────────
  page.drawRectangle({ x: MARGIN, y: y - 20, width: 22, height: 22, color: rgb(0, 0.784, 0.588) })
  page.drawText("V", { x: MARGIN + 7, y: y - 14, size: 13, font: bold, color: rgb(1, 1, 1) })
  page.drawText("Vantro", { x: MARGIN + 32, y: y - 14, size: 13, font: bold, color: INK })
  y -= 52

  page.drawText("Your week", { x: MARGIN, y, size: 24, font: bold, color: INK })
  y -= 20
  page.drawText(printable(`${input.companyName} · ${weekStartLabel} to ${weekEndLabel}`), {
    x: MARGIN, y, size: 11, font: regular, color: MUTED,
  })
  y -= 28
  rule(page, y)
  y -= 28

  // ─── Four figures ────────────────────────────────────────────────────────
  const stats: Array<[string, string]> = [
    ["Hours worked", h(input.totalHours)],
    ["Shifts", String(input.shiftCount)],
    ["People on site", String(input.peopleOnSite)],
    ["Jobs worked", String(input.jobsWorked)],
  ]
  const colW = (PAGE_W - MARGIN * 2) / 4
  stats.forEach(([label, value], i) => {
    const x = MARGIN + i * colW
    page.drawText(label, { x, y, size: 9, font: regular, color: MUTED })
    page.drawText(value, { x, y: y - 22, size: 20, font: bold, color: INK })
  })
  y -= 52
  rule(page, y)
  y -= 30

  // ─── Hours per day ───────────────────────────────────────────────────────
  page.drawText("Hours per day", { x: MARGIN, y, size: 12, font: bold, color: INK })
  y -= 22

  const maxDay = Math.max(...input.dailyHours, 1)
  const barMaxW = PAGE_W - MARGIN * 2 - 90
  input.dailyHours.forEach((hours, i) => {
    const rowY = y - i * 20
    page.drawText(DAY_LABELS[i], { x: MARGIN, y: rowY, size: 10, font: regular, color: MUTED })
    const width = Math.max(1, (hours / maxDay) * barMaxW)
    page.drawRectangle({
      x: MARGIN + 34, y: rowY - 2, width, height: 10,
      // Today's colour at full strength for the busiest day reads as a chart
      // rather than a table; everything else sits back.
      color: hours === maxDay && hours > 0 ? ACCENT : rgb(0.78, 0.9, 0.86),
    })
    page.drawText(h(hours), {
      x: MARGIN + 40 + width, y: rowY, size: 9, font: regular, color: MUTED,
    })
  })
  y -= input.dailyHours.length * 20 + 14
  rule(page, y)
  y -= 30

  // ─── Per person ──────────────────────────────────────────────────────────
  page.drawText("Who worked", { x: MARGIN, y, size: 12, font: bold, color: INK })
  y -= 22

  if (input.perPerson.length === 0) {
    page.drawText("Nobody signed in this week.", { x: MARGIN, y, size: 10, font: regular, color: MUTED })
    y -= 20
  } else {
    page.drawText("Name", { x: MARGIN, y, size: 9, font: regular, color: MUTED })
    page.drawText("Shifts", { x: PAGE_W - MARGIN - 150, y, size: 9, font: regular, color: MUTED })
    page.drawText("Hours", { x: PAGE_W - MARGIN - 60, y, size: 9, font: regular, color: MUTED })
    y -= 6
    rule(page, y)
    y -= 16

    for (const person of input.perPerson) {
      if (y < MARGIN + 80) break // one page; the detail lives in the app
      page.drawText(truncate(person.name, 44), { x: MARGIN, y, size: 10, font: regular, color: INK })
      page.drawText(String(person.shifts), {
        x: PAGE_W - MARGIN - 150, y, size: 10, font: regular, color: MUTED,
      })
      page.drawText(h(person.hours), {
        x: PAGE_W - MARGIN - 60, y, size: 10, font: bold, color: INK,
      })
      y -= 18
    }
  }

  // ─── Footer ──────────────────────────────────────────────────────────────
  const footerY = MARGIN
  rule(page, footerY + 26)
  const retention = input.retentionDays
    ? `Shift records are kept for ${input.retentionDays} days on the Free plan, so keep this summary. ` +
      `Upgrade to keep the detail.`
    : `Generated by Vantro.`
  page.drawText(retention, { x: MARGIN, y: footerY + 10, size: 8, font: regular, color: MUTED })
  page.drawText("app.getvantro.com", {
    x: PAGE_W - MARGIN - 88, y: footerY + 10, size: 8, font: regular, color: MUTED,
  })

  return doc.save()
}

function rule(page: PDFPage, y: number) {
  page.drawRectangle({ x: MARGIN, y, width: PAGE_W - MARGIN * 2, height: 0.8, color: LINE })
}

// Characters that do not decompose under NFD, so stripping combining marks
// leaves them untouched. A short list on purpose: these are the ones that turn
// up in the names this product actually carries.
const HARD_CASES: Record<string, string> = {
  "ł": "l", "Ł": "L", // l-stroke, Polish
  "đ": "d", "Đ": "D",
  "ø": "o", "Ø": "O",
  "æ": "ae", "Æ": "AE",
  "ß": "ss",
  "—": "-", "–": "-", "‘": "'", "’": "'",
  "“": '"', "”": '"', "…": "...",
}

/**
 * Make a string printable in Helvetica.
 *
 * The base-14 fonts stop at Latin-1 and pdf-lib throws on anything past it
 * rather than dropping it, so this has to happen somewhere. Replacing those
 * characters with a dot was the first version and it was wrong for this
 * product: the app is translated into Polish, Romanian and Lithuanian, so a
 * worker called Slusarz came out of a payroll summary as ".lusarz".
 * Transliterating gives the name spelled plainly instead of redacted.
 *
 * Embedding a Unicode font would keep the diacritics properly, and is the
 * right answer if this report ever has to be authoritative. It costs a font
 * file plus @pdf-lib/fontkit, which a one-page weekly summary does not justify
 * yet.
 */
function printable(value: string): string {
  const mapped = String(value || "").replace(
    /[ŁłĐđØøÆæß–—‘’“”…]/g,
    (c) => HARD_CASES[c] ?? c,
  )
  // NFD splits an accented letter into its base plus a combining mark;
  // dropping the marks leaves the base letter, which covers almost all of
  // Latin Extended-A.
  const stripped = mapped.normalize("NFD").replace(/[̀-ͯ]/g, "")
  // Anything still outside Latin-1 would throw, so it becomes a dot as a last
  // resort rather than costing the company its whole report.
  return stripped.replace(/[^\x20-\xFF]/g, "·")
}

function truncate(value: string, max: number): string {
  const safe = printable(value)
  return safe.length > max ? safe.slice(0, max - 3) + "..." : safe
}


/** The Monday of the week that has just finished, for a Friday send. */
export function currentWeekStart(now: Date): string {
  return isoWeekStart(now)
}
