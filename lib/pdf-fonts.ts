// lib/pdf-fonts.ts
//
// Real Unicode fonts for the PDFs, so a name is spelled the way its owner
// spells it.
//
// THE PROBLEM THIS SOLVES
// pdf-lib's base-14 fonts stop at Latin-1 and throw on anything past it, so
// every PDF this product makes has been transliterating: Ślusarz printed as
// Slusarz, Ștefan as Stefan, Šarūnas as Sarunas. That was the right trade while
// the only document was an internal weekly summary -- a redacted name is worse
// than a flattened one. It stopped being the right trade when the app was
// translated into Polish, Romanian and Lithuanian and started producing
// documents that go to clients: a payroll summary and a retention claim letter
// with a worker's name misspelled on it is the kind of small insult people
// remember.
//
// Noto Sans covers Latin, Greek and Cyrillic, which is every language this
// product currently ships in with room to spare. SIL Open Font License, so
// embedding it in a generated PDF is fine.
//
// WHY THE FILES ARE READ FROM DISK
// Two 600KB fonts base64-encoded into a TypeScript module would be 1.6MB of
// source that every bundle and every editor has to carry. They are read once,
// lazily, and cached for the life of the process instead.
//
// next.config.ts has an outputFileTracingIncludes entry that ships these with
// the API functions. Nothing imports them, so tracing cannot discover them by
// itself, and without that entry this works locally and fails on Vercel.

import fs from "fs"
import path from "path"
import fontkit from "@pdf-lib/fontkit"
import { StandardFonts, type PDFDocument, type PDFFont } from "pdf-lib"

const FONT_DIR = path.join(process.cwd(), "assets", "fonts")

export type PdfFonts = {
  regular: PDFFont
  bold: PDFFont
  /**
   * True when the real Unicode fonts are in use.
   *
   * False means we fell back to Helvetica and callers must keep putting text
   * through printable() or pdf-lib will throw on the first accented character.
   */
  unicode: boolean
}

// Cached per process. Reading and parsing 1.2MB of font on every PDF would add
// real latency to a serverless invocation that is otherwise fast.
let cached: { regular: Buffer; bold: Buffer } | null = null
let loadFailed = false

function loadFontFiles(): { regular: Buffer; bold: Buffer } | null {
  if (cached) return cached
  if (loadFailed) return null
  try {
    cached = {
      regular: fs.readFileSync(path.join(FONT_DIR, "NotoSans-Regular.ttf")),
      bold: fs.readFileSync(path.join(FONT_DIR, "NotoSans-Bold.ttf")),
    }
    return cached
  } catch (err: any) {
    // Logged loudly and once. A missing font must not stop a company getting
    // its payroll summary or its retention claim -- a transliterated name is a
    // far smaller problem than no document at all -- but it is a deployment
    // fault and somebody has to be told.
    loadFailed = true
    console.error(
      "[pdf-fonts] Noto Sans not found, falling back to Helvetica with " +
        "transliterated names. Check outputFileTracingIncludes in next.config.ts:",
      err?.message || err,
    )
    return null
  }
}

/**
 * Embed the document fonts.
 *
 * Always succeeds. If the Unicode fonts cannot be loaded or parsed it returns
 * the base-14 pair with unicode:false, and the caller transliterates as before.
 */
export async function embedPdfFonts(doc: PDFDocument): Promise<PdfFonts> {
  const files = loadFontFiles()

  if (files) {
    try {
      doc.registerFontkit(fontkit)
      // subset: true keeps only the glyphs actually used. Without it every PDF
      // carries the whole 600KB face, which on a weekly email to every free
      // company is a bandwidth bill for glyphs nobody looked at.
      const regular = await doc.embedFont(files.regular, { subset: true })
      const bold = await doc.embedFont(files.bold, { subset: true })
      return { regular, bold, unicode: true }
    } catch (err: any) {
      console.error("[pdf-fonts] embedding failed, falling back to Helvetica:", err?.message || err)
    }
  }

  return {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    unicode: false,
  }
}
