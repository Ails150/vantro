// lib/retention-letter.ts
//
// The retention claim letter: one page of A4 that asks a client for the money
// they are holding, and says what the claim rests on.
//
// This is the only document Vantro produces that is meant to leave the industry
// and land on a client's desk. That changes what it has to be. The weekly
// report is an internal summary and can look like a dashboard; this cannot. It
// is laid out as a letter -- sender, date, recipient, subject line, body,
// figures, signature block -- because a claim that looks like an app export is
// easier to ignore than one that looks like correspondence.
//
// THE EVIDENCE PACK REFERENCE IS THE POINT
// Anyone can send an invoice. What makes this one hard to wave away is the line
// naming the job's signed audit pack and the URL that verifies it: the hours,
// the sign-offs and the photographs behind the finished work are hashed into a
// merkle root that we cannot alter after the fact. The reference is printed in
// the body rather than buried in a footer, because the whole argument of the
// letter is "the work is evidenced, now release the money".
//
// The pack is CITED, not embedded. A pack is a large multi-page document with
// signed URLs inside it, and stapling it to every claim letter would make a
// 10MB attachment that mostly nobody opens, while the signed URLs inside it
// expire. A reference plus a verify URL stays true for as long as the record
// does, and the client can pull the pack if they want it.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib"
import { printable, truncate, wrapText } from "./pdf-text"
import { formatMoney } from "./retention"

const INK = rgb(0.043, 0.059, 0.078)
const MUTED = rgb(0.357, 0.4, 0.451)
const LINE = rgb(0.918, 0.925, 0.941)

const PAGE_W = 595.28 // A4 portrait, points
const PAGE_H = 841.89
const MARGIN = 64
const BODY_W = PAGE_W - MARGIN * 2

export type RetentionLetterInput = {
  companyName: string
  jobName: string
  /** The client or main contractor the claim is addressed to. */
  contractor: string | null
  jobAddress: string | null
  contractValue: number | null
  retentionPercent: number | null
  amountHeld: number
  practicalCompletionDate: string | null
  defectsPeriodMonths: number | null
  claimDueDate: string | null
  /** Audit pack reference for this job, if one has been generated. */
  evidencePackReference: string | null
  /** Where that reference can be checked. */
  verifyUrl: string | null
  /** Today, YYYY-MM-DD. Passed in so the letter is reproducible in a test. */
  issuedOn: string
}

export async function renderRetentionLetterPdf(input: RetentionLetterInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([PAGE_W, PAGE_H])
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  let y = PAGE_H - MARGIN

  // ─── Sender ──────────────────────────────────────────────────────────────
  page.drawText(truncate(input.companyName, 60), {
    x: MARGIN, y, size: 15, font: bold, color: INK,
  })
  y -= 16
  page.drawText(longDate(input.issuedOn), { x: MARGIN, y, size: 10, font: regular, color: MUTED })
  y -= 34

  // ─── Recipient ───────────────────────────────────────────────────────────
  // "The Accounts Department" rather than a blank: a letter with an empty
  // addressee looks unfinished, and we do not hold a contact name for the
  // client. The sender can write over it if they want to.
  page.drawText(truncate(input.contractor || "The Accounts Department", 60), {
    x: MARGIN, y, size: 11, font: bold, color: INK,
  })
  y -= 30

  // ─── Subject ─────────────────────────────────────────────────────────────
  const subject = `Release of retention - ${input.jobName}`
  page.drawText(truncate(subject, 66), { x: MARGIN, y, size: 12, font: bold, color: INK })
  y -= 10
  rule(page, y)
  y -= 26

  // ─── Body ────────────────────────────────────────────────────────────────
  const dueLabel = input.claimDueDate ? longDate(input.claimDueDate) : null
  const pcLabel = input.practicalCompletionDate ? longDate(input.practicalCompletionDate) : null

  const opening =
    pcLabel && dueLabel
      ? `We write in respect of retention held against the above contract. Practical completion ` +
        `was certified on ${pcLabel} and the defects liability period of ` +
        `${input.defectsPeriodMonths} months ` +
        `${monthsVerb(input.defectsPeriodMonths, input.claimDueDate!, input.issuedOn)} on ${dueLabel}. ` +
        `The retention sum is therefore due for release.`
      : `We write in respect of retention held against the above contract, and request that the ` +
        `retention sum shown below is released in accordance with the terms of the contract.`

  y = paragraph(page, opening, regular, 10.5, y)
  y -= 14

  // ─── Figures ─────────────────────────────────────────────────────────────
  const rows: Array<[string, string]> = []
  if (input.contractValue) rows.push(["Contract value", formatMoney(input.contractValue)])
  if (input.retentionPercent != null) {
    rows.push(["Retention", `${trimPercent(input.retentionPercent)}%`])
  }
  if (pcLabel) rows.push(["Practical completion", pcLabel])
  if (input.defectsPeriodMonths != null) {
    rows.push(["Defects liability period", `${input.defectsPeriodMonths} months`])
  }
  if (dueLabel) rows.push(["Due for release", dueLabel])

  for (const [label, value] of rows) {
    page.drawText(label, { x: MARGIN, y, size: 10, font: regular, color: MUTED })
    page.drawText(printable(value), { x: MARGIN + 190, y, size: 10, font: regular, color: INK })
    y -= 18
  }

  y -= 6
  rule(page, y)
  y -= 22

  // The number the letter is actually about, given its own weight. Everything
  // above is the working; this is the ask.
  page.drawText("Amount now due", { x: MARGIN, y, size: 11, font: bold, color: INK })
  page.drawText(printable(formatMoney(input.amountHeld)), {
    x: MARGIN + 190, y: y - 4, size: 18, font: bold, color: INK,
  })
  y -= 34
  rule(page, y)
  y -= 26

  // ─── Evidence ────────────────────────────────────────────────────────────
  if (input.evidencePackReference) {
    page.drawText("Supporting evidence", { x: MARGIN, y, size: 11, font: bold, color: INK })
    y -= 18

    y = paragraph(
      page,
      `A signed compliance pack covering the works on this contract is registered under the ` +
        `reference below. It records the attendance, quality sign-offs and site records for the ` +
        `job, sealed so that they cannot be altered after issue.`,
      regular,
      10.5,
      y,
    )
    y -= 6

    page.drawText("Pack reference", { x: MARGIN, y, size: 10, font: regular, color: MUTED })
    page.drawText(printable(input.evidencePackReference), {
      x: MARGIN + 190, y, size: 11, font: bold, color: INK,
    })
    y -= 18

    if (input.verifyUrl) {
      page.drawText("Verify at", { x: MARGIN, y, size: 10, font: regular, color: MUTED })
      const urlLines = wrapText(input.verifyUrl, regular, 10, BODY_W - 190)
      for (const line of urlLines) {
        page.drawText(line, { x: MARGIN + 190, y, size: 10, font: regular, color: INK })
        y -= 14
      }
      y -= 4
    }
    y -= 12
  } else {
    // Said plainly rather than left out. An admin who expected the pack line to
    // appear needs to know why it did not, and a letter that silently drops its
    // strongest argument is worse than one that explains the gap.
    y = paragraph(
      page,
      `Supporting records for this contract are held in full and can be provided on request.`,
      regular,
      10.5,
      y,
    )
    y -= 12
  }

  // ─── Closing ─────────────────────────────────────────────────────────────
  y = paragraph(
    page,
    `We should be grateful if you would arrange release of the sum shown above. Please contact us ` +
      `if any further information is required to process this claim.`,
    regular,
    10.5,
    y,
  )
  y -= 30

  page.drawText("Yours faithfully", { x: MARGIN, y, size: 10.5, font: regular, color: INK })
  y -= 38
  page.drawText(truncate(input.companyName, 60), { x: MARGIN, y, size: 10.5, font: bold, color: INK })

  // ─── Footer ──────────────────────────────────────────────────────────────
  rule(page, MARGIN + 26)
  page.drawText(
    truncate(
      input.jobAddress ? `${input.jobName} - ${input.jobAddress}` : input.jobName,
      74,
    ),
    { x: MARGIN, y: MARGIN + 10, size: 8, font: regular, color: MUTED },
  )
  page.drawText("Generated by Vantro", {
    x: PAGE_W - MARGIN - 92, y: MARGIN + 10, size: 8, font: regular, color: MUTED,
  })

  return doc.save()
}

/** Draw wrapped prose and return the new y. */
function paragraph(
  page: PDFPage,
  text: string,
  font: PDFFont,
  size: number,
  startY: number,
): number {
  let y = startY
  for (const line of wrapText(text, font, size, BODY_W)) {
    page.drawText(line, { x: MARGIN, y, size, font, color: INK })
    y -= size * 1.55
  }
  return y
}

function rule(page: PDFPage, y: number) {
  page.drawRectangle({ x: MARGIN, y, width: BODY_W, height: 0.8, color: LINE })
}

/** "15 September 2026". Letters do not print ISO dates. */
function longDate(dateOnly: string): string {
  const parsed = Date.parse(`${dateOnly.slice(0, 10)}T12:00:00Z`)
  if (!Number.isFinite(parsed)) return dateOnly
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  }).format(new Date(parsed))
}

/**
 * "expires" or "expired", depending on which side of today the date falls.
 *
 * A letter that tells a client their defects period "expires on" a date fifteen
 * months ago reads as a mail merge nobody checked, which is exactly the
 * impression a claim must not give.
 */
function monthsVerb(_months: number | null, dueDate: string, today: string): string {
  return dueDate <= today ? "expired" : "expires"
}

/** 5.00 -> "5", 5.25 -> "5.25". Nobody writes "5.00% retention". */
function trimPercent(percent: number): string {
  return String(Number(percent))
}
