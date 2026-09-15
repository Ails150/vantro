// lib/pdf-text.ts
//
// Making a string safe to draw with pdf-lib's base-14 fonts.
//
// This lived inside lib/weekly-report.ts while the weekly report was the only
// PDF that drew a person's name. The retention claim letter is the second, and
// it prints company names and contractor names -- exactly the strings that
// break. Two copies of a transliteration table is how one of them quietly stops
// matching the other, so it moved here rather than being pasted.

import type { PDFFont } from "pdf-lib"

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
 * Embedding a Unicode font would keep the diacritics properly, and is the right
 * answer if either of these documents ever has to be authoritative. It costs a
 * font file plus @pdf-lib/fontkit, which a one-page summary does not justify
 * yet.
 */
export function printable(value: string): string {
  const mapped = String(value || "").replace(
    /[ŁłĐđØøÆæß–—‘’“”…]/g,
    (c) => HARD_CASES[c] ?? c,
  )
  // NFD splits an accented letter into its base plus a combining mark;
  // dropping the marks leaves the base letter, which covers almost all of
  // Latin Extended-A.
  const stripped = mapped.normalize("NFD").replace(/[̀-ͯ]/g, "")
  // Anything still outside Latin-1 would throw, so it becomes a dot as a last
  // resort rather than costing the company its whole document.
  return stripped.replace(/[^\x20-\xFF]/g, "·")
}

export function truncate(value: string, max: number): string {
  const safe = printable(value)
  return safe.length > max ? safe.slice(0, max - 3) + "..." : safe
}

/**
 * Break text into lines that fit a width, measuring the real font.
 *
 * The weekly report never needed this -- it prints short fields in fixed
 * columns. A letter is prose, and prose that runs off the right edge of an A4
 * page is not a letter you would send to a client.
 */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = printable(text).split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ""

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate
      continue
    }
    if (line) lines.push(line)
    // A single word longer than the line (a URL, a pack reference) is broken by
    // character rather than allowed to overflow.
    if (font.widthOfTextAtSize(word, size) > maxWidth) {
      let chunk = ""
      for (const char of word) {
        if (font.widthOfTextAtSize(chunk + char, size) > maxWidth) {
          lines.push(chunk)
          chunk = char
        } else {
          chunk += char
        }
      }
      line = chunk
    } else {
      line = word
    }
  }
  if (line) lines.push(line)
  return lines
}
