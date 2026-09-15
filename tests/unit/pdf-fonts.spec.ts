import { test, expect } from "@playwright/test"
import { PDFDocument } from "pdf-lib"
import { embedPdfFonts } from "../../lib/pdf-fonts"
import { printable, textSafety, wrapText } from "../../lib/pdf-text"
import { renderRetentionLetterPdf } from "../../lib/retention-letter"
import { renderWeeklyReportPdf, summariseWeek } from "../../lib/weekly-report"

/**
 * The names this product actually carries. Every one of these used to come out
 * of a PDF flattened, and one of them ("Ślusarz") used to come out as
 * ".lusarz" before transliteration was added.
 */
const NAMES = [
  "Paweł Ślusarz",
  "Ștefan Ionuț Mureșan",
  "Šarūnas Žukauskas",
  "Søren Ødegård",
  "Zoë Müller-Kraft",
]

test.describe("the fonts actually load", () => {
  test("Noto Sans embeds, and reports itself as unicode", async () => {
    const doc = await PDFDocument.create()
    const fonts = await embedPdfFonts(doc)
    // If this is false the font files did not ship. That is a deployment fault
    // and the whole point of this test is to catch it in CI rather than in a
    // customer's inbox.
    expect(fonts.unicode).toBe(true)
  })

  test("the embedded font can measure every name without throwing", async () => {
    const doc = await PDFDocument.create()
    const fonts = await embedPdfFonts(doc)
    for (const name of NAMES) {
      expect(() => fonts.regular.widthOfTextAtSize(name, 10)).not.toThrow()
      expect(fonts.regular.widthOfTextAtSize(name, 10)).toBeGreaterThan(0)
    }
  })
})

test.describe("textSafety", () => {
  test("with unicode, names pass through exactly as spelled", () => {
    const safe = textSafety(true)
    for (const name of NAMES) expect(safe.text(name)).toBe(name)
  })

  test("without unicode, names are transliterated rather than redacted", () => {
    const safe = textSafety(false)
    expect(safe.text("Paweł Ślusarz")).toBe("Pawel Slusarz")
    expect(safe.text("Šarūnas")).toBe("Sarunas")
    // The bug that started all this: a leading l-stroke became a dot.
    expect(safe.text("Ślusarz")).not.toContain("·")
  })

  test("truncation still respects the limit in both modes", () => {
    const long = "Ștefan Ionuț Mureșan and a very long company name indeed"
    expect(textSafety(true).truncate(long, 20).length).toBeLessThanOrEqual(20)
    expect(textSafety(false).truncate(long, 20).length).toBeLessThanOrEqual(20)
  })
})

test.describe("wrapText does not quietly undo the embedding", () => {
  test("given the unicode safety function, accents survive wrapping", async () => {
    const doc = await PDFDocument.create()
    const fonts = await embedPdfFonts(doc)
    const safe = textSafety(fonts.unicode)
    const lines = wrapText("Paweł Ślusarz and Ștefan Mureșan", fonts.regular, 10, 400, safe.text)
    expect(lines.join(" ")).toContain("Ślusarz")
    expect(lines.join(" ")).toContain("Mureșan")
  })

  test("the default is still transliteration, for the Helvetica fallback", async () => {
    const doc = await PDFDocument.create()
    const fonts = await embedPdfFonts(doc)
    const lines = wrapText("Paweł Ślusarz", fonts.regular, 10, 400)
    expect(lines.join(" ")).toBe("Pawel Slusarz")
  })
})

test.describe("whole documents render with these names in them", () => {
  test("the weekly report", async () => {
    const summary = summariseWeek(
      "Żabka Glazing Ltd",
      "2026-09-14",
      NAMES.map((name, i) => ({
        id: String(i),
        user_id: String(i),
        job_id: "j1",
        signed_in_at: "2026-09-14T07:00:00Z",
        signed_out_at: "2026-09-14T15:30:00Z",
        hours_worked: 8.5,
        users: { name },
      })),
      null,
    )
    const pdf = await renderWeeklyReportPdf(summary)
    expect(pdf.byteLength).toBeGreaterThan(1000)
  })

  test("the retention claim letter", async () => {
    const pdf = await renderRetentionLetterPdf({
      companyName: "Żabka Glazing Ltd",
      jobName: "Ųpės Street — Phase 1",
      contractor: "Mureșan Construcții SRL",
      jobAddress: "12 Ślusarska, Kraków",
      contractValue: 48000,
      retentionPercent: 5,
      amountHeld: 2400,
      practicalCompletionDate: "2025-10-15",
      defectsPeriodMonths: 12,
      claimDueDate: "2026-10-15",
      evidencePackReference: "VNT-7K2M-9QXR",
      verifyUrl: "https://getvantro.com/verify",
      issuedOn: "2026-09-15",
    })
    expect(pdf.byteLength).toBeGreaterThan(1000)
  })

  test("a name outside Latin still cannot break a document", async () => {
    // Noto Sans covers Latin, Greek and Cyrillic. Something outside all three
    // must degrade, not throw, because a missing glyph is not a reason for a
    // company to lose its payroll summary.
    const summary = summariseWeek(
      "Vantro",
      "2026-09-14",
      [{
        id: "1", user_id: "1", job_id: "j1",
        signed_in_at: "2026-09-14T07:00:00Z",
        signed_out_at: "2026-09-14T15:30:00Z",
        hours_worked: 8.5,
        users: { name: "田中 太郎" },
      }],
      null,
    )
    await expect(renderWeeklyReportPdf(summary)).resolves.toBeTruthy()
  })
})
