// lib/gdpr-export-pdf.ts
//
// The readable half of an Article 15 response.
//
// A subject access request is answered for a person, not for a system. The JSON
// is the complete machine-readable copy; this is the document somebody can sit
// down with. It prints a summary of each section and the rows underneath it,
// truncated to what fits, and says plainly where the full detail is -- rather
// than pretending a hundred pages of raw location pings are a useful answer.

import { PDFDocument, rgb, type PDFPage } from "pdf-lib"
import { embedPdfFonts } from "./pdf-fonts"
import { textSafety, wrapText } from "./pdf-text"

const INK = rgb(0.043, 0.059, 0.078)
const MUTED = rgb(0.357, 0.4, 0.451)
const LINE = rgb(0.918, 0.925, 0.941)

const PAGE_W = 595.28
const PAGE_H = 841.89
const MARGIN = 56
const BODY_W = PAGE_W - MARGIN * 2

/** Rows printed in full per section before it says "and N more". */
const ROWS_SHOWN = 8

export type SubjectExport = {
  generatedAt: string
  company: { id?: string; name?: string }
  subject: Record<string, any>
  sections: Array<{ label: string; source: string; count: number; error?: string; rows: any[] }>
  notes: readonly string[]
}

export async function renderSubjectExportPdf(data: SubjectExport): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const fonts = await embedPdfFonts(doc)
  const safe = textSafety(fonts.unicode)

  let page = doc.addPage([PAGE_W, PAGE_H])
  let y = PAGE_H - MARGIN

  /** Start a new page when the next block will not fit. */
  const need = (height: number) => {
    if (y - height < MARGIN + 30) {
      page = doc.addPage([PAGE_W, PAGE_H])
      y = PAGE_H - MARGIN
    }
  }

  const text = (
    value: string,
    opts: { size?: number; bold?: boolean; colour?: any; indent?: number } = {},
  ) => {
    const size = opts.size ?? 10
    const font = opts.bold ? fonts.bold : fonts.regular
    const x = MARGIN + (opts.indent ?? 0)
    for (const line of wrapText(value, font, size, BODY_W - (opts.indent ?? 0), safe.text)) {
      need(size * 1.6)
      page.drawText(line, { x, y, size, font, color: opts.colour ?? INK })
      y -= size * 1.5
    }
  }

  const rule = () => {
    need(12)
    page.drawRectangle({ x: MARGIN, y, width: BODY_W, height: 0.8, color: LINE })
    y -= 14
  }

  // ─── Header ──────────────────────────────────────────────────────────────
  text("Your data", { size: 22, bold: true })
  y -= 6
  text(
    `Held by ${data.company.name ?? "this company"} in Vantro. ` +
      `Produced ${formatDate(data.generatedAt)}.`,
    { size: 10, colour: MUTED },
  )
  y -= 8
  rule()

  text(
    "This is everything recorded about you. The machine-readable copy of the " +
      "same data is available as a JSON file, which includes every row in full.",
    { size: 10, colour: MUTED },
  )
  y -= 10

  // ─── Who ─────────────────────────────────────────────────────────────────
  text("About you", { size: 13, bold: true })
  y -= 4
  for (const [label, key] of [
    ["Name", "name"], ["Email", "email"], ["Phone", "phone"], ["Role", "role"],
    ["Joined", "joined"], ["Shift start", "shiftStart"], ["Shift end", "shiftEnd"],
    ["Hourly rate", "hourlyRate"],
  ] as Array<[string, string]>) {
    const value = data.subject[key]
    if (value === null || value === undefined || value === "") continue
    need(15)
    page.drawText(safe.text(label), { x: MARGIN, y, size: 9, font: fonts.regular, color: MUTED })
    page.drawText(safe.truncate(String(formatValue(value)), 60), {
      x: MARGIN + 130, y, size: 10, font: fonts.regular, color: INK,
    })
    y -= 15
  }
  y -= 8
  rule()

  // ─── Sections ────────────────────────────────────────────────────────────
  for (const section of data.sections) {
    // A section with nothing in it is still worth one line: "we hold no diary
    // entries for you" is part of a complete answer, not an omission.
    need(40)
    text(section.label, { size: 12, bold: true })
    if (section.error) {
      text(`Could not be read: ${section.error}`, { size: 9, colour: rgb(0.7, 0.2, 0.2) })
      y -= 6
      continue
    }
    text(
      section.count === 0
        ? "Nothing recorded."
        : `${section.count} ${section.count === 1 ? "record" : "records"}.`,
      { size: 9, colour: MUTED },
    )

    for (const row of section.rows.slice(0, ROWS_SHOWN)) {
      const summary = summariseRow(row)
      if (!summary) continue
      text(`- ${summary}`, { size: 9, indent: 8, colour: INK })
    }
    if (section.count > ROWS_SHOWN) {
      text(`- and ${section.count - ROWS_SHOWN} more, in the JSON copy`, {
        size: 9, indent: 8, colour: MUTED,
      })
    }
    y -= 8
  }

  // ─── Notes ───────────────────────────────────────────────────────────────
  rule()
  text("What we keep, and why", { size: 12, bold: true })
  y -= 2
  for (const note of data.notes) {
    text(`- ${note}`, { size: 9, colour: MUTED, indent: 4 })
    y -= 2
  }

  return doc.save()
}

/**
 * One line describing a row, without knowing what table it came from.
 *
 * Prefers a timestamp and then whatever text the row carries. Deliberately
 * generic: a per-table formatter for twenty tables would be twenty things to
 * keep in step with the schema, and this is a summary with the JSON behind it
 * rather than the authoritative copy.
 */
function summariseRow(row: any): string {
  if (!row || typeof row !== "object") return ""

  const when =
    row.signed_in_at || row.occurred_at || row.created_at || row.submitted_at ||
    row.reported_at || row.signed_at || row.delivered_at || row.awarded_on ||
    row.date || row.hit_at

  const what =
    row.description || row.entry_text || row.notes || row.reason || row.title ||
    row.label || row.kind || row.status || row.state || row.value ||
    row.type || row.name || ""

  const parts: string[] = []
  if (when) parts.push(formatDate(String(when)))
  if (what) parts.push(String(what).slice(0, 90))
  // Something with neither is still a record, and saying so beats an empty
  // bullet that looks like a rendering fault.
  if (parts.length === 0) return "Record held (see the JSON copy for the detail)"
  return parts.join("  ")
}

function formatValue(value: any): string {
  if (Array.isArray(value)) return value.join(", ")
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return formatDate(value)
  return String(value)
}

function formatDate(value: string): string {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return String(value).slice(0, 19)
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/London",
  }).format(new Date(parsed))
}
