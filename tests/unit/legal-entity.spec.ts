import { test, expect } from "@playwright/test"
import fs from "fs"
import path from "path"

/**
 * One company, one number, one trading name — everywhere it appears.
 *
 * Vantro is a product of CNNCTD Ltd. That is an ordinary arrangement and a
 * perfectly good one, but it means the name on the screen and the name on the
 * contract are different, which is how a product ends up telling three
 * different stories about who its customers are actually dealing with. Before
 * this test it was telling three: the privacy page said CNNCTD Ltd trading as
 * *Scale 8 Digital*, the terms page said the same, the PDFs said CNNCTD Ltd
 * with no trading name, and the drafts said [TO CONFIRM].
 *
 * An entity mismatch is not a typo. It is the first thing anybody checks when
 * they are deciding whether to sue, and the answer "we were not sure which
 * company you were contracting with" is not one anybody wants to give.
 */

const ROOT = process.cwd()

const ENTITY = "CNNCTD Ltd"
const COMPANY_NUMBER = "NI695071"
const TRADING_AS = "Vantro"
/** What the entity used to be described as, and must not be again. */
const WRONG_TRADING_NAMES = ["Scale 8 Digital", "Scale8 Digital"]

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8")
}

/** Every file that names the company to a customer. */
const CUSTOMER_FACING = [
  "app/privacy/page.tsx",
  "app/legal/terms/page.tsx",
  "app/verify/page.tsx",
  "app/api/audit/email/route.ts",
  "app/api/audit/report/route.ts",
  "app/api/qa/checklist-pdf/route.ts",
]

const DRAFTS = [
  "docs/legal/terms.md",
  "docs/legal/dpa.md",
  "docs/legal/privacy-policy.md",
  "docs/legal/README.md",
]

test.describe("the company number", () => {
  for (const file of [...CUSTOMER_FACING, ...DRAFTS]) {
    test(`${file} carries ${COMPANY_NUMBER}`, () => {
      const src = read(file)
      expect(src, `${file} names the company without its number`).toContain(COMPANY_NUMBER)
      expect(src).toContain(ENTITY)
    })
  }

  test("no other company number appears anywhere", () => {
    // A stray NI or England number is either a typo or a different company,
    // and both are worse than no number at all.
    const offenders: string[] = []
    for (const file of [...CUSTOMER_FACING, ...DRAFTS]) {
      const src = read(file)
      for (const m of src.matchAll(/\b(NI|SC|NC)\d{6}\b|\bcompany number\s+(\d{8})\b/gi)) {
        const found = m[0]
        if (found.includes(COMPANY_NUMBER)) continue
        offenders.push(`${file}: ${found}`)
      }
    }
    expect(offenders, offenders.join("; ")).toEqual([])
  })
})

test.describe("the trading name", () => {
  test("the old one is gone from everything customer facing", () => {
    // Line by line, and a line that says the name is HISTORICAL does not count.
    //
    // The drafts record what changed -- "the live page previously said the
    // trading name was Scale 8 Digital" -- and that sentence is the reason
    // anybody reviewing them will understand why. A test that forces the
    // documentation to stop mentioning what it fixed makes the documentation
    // worse in order to make itself pass.
    const HISTORICAL = /previously|used to|no longer|does not any more|formerly|was\s+\*?Scale/i
    const offenders: string[] = []
    for (const file of [...CUSTOMER_FACING, ...DRAFTS]) {
      const lines = read(file).split("\n")
      lines.forEach((line, i) => {
        for (const wrong of WRONG_TRADING_NAMES) {
          if (!line.includes(wrong)) continue
          if (HISTORICAL.test(line)) continue
          offenders.push(`${file}:${i + 1} "${wrong}"`)
        }
      })
    }
    expect(offenders, `an old trading name is stated as current: ${offenders.join("; ")}`)
      .toEqual([])
  })

  test("and never on a published page, historical or not", () => {
    // A customer reading /privacy has no use for what the trading name was.
    const offenders = CUSTOMER_FACING.filter(f =>
      WRONG_TRADING_NAMES.some(w => read(f).includes(w)),
    )
    expect(offenders, offenders.join(", ")).toEqual([])
  })

  test("the two documents a customer signs say who they are signing with", () => {
    // The terms and the DPA are the two that matter. A footer naming the entity
    // is useful; a contract that does not is a problem.
    for (const file of ["app/legal/terms/page.tsx", "docs/legal/dpa.md", "docs/legal/terms.md"]) {
      const src = read(file)
      expect(src, `${file} does not say it trades as ${TRADING_AS}`)
        .toMatch(new RegExp(`trading as[\\s\\S]{0,40}${TRADING_AS}`))
    }
  })

  test("and that it is a Northern Ireland registration", () => {
    // NI695071 is an NI number, and Northern Ireland is a separate
    // jurisdiction from England and Wales. Saying so is what makes the
    // governing-law clause a choice rather than an oversight.
    for (const file of ["app/legal/terms/page.tsx", "docs/legal/terms.md", "docs/legal/dpa.md"]) {
      expect(read(file), `${file} does not say where the company is registered`)
        .toMatch(/Northern Ireland/)
    }
  })
})

test.describe("the placeholders that are left", () => {
  test("none of them is the entity, the number or the trading name", () => {
    // The drafts still have holes -- the registered office, the ICO number, the
    // DPO question. Those are honest. What must not remain is a hole where the
    // company's identity goes, because that one has been answered.
    const offenders: string[] = []
    for (const file of DRAFTS) {
      const src = read(file)
      for (const m of src.matchAll(/\[TO CONFIRM[^\]]*\]/g)) {
        const text = m[0].toLowerCase()
        if (/company name|company number|registered company|entity|trading name/.test(text)) {
          offenders.push(`${file}: ${m[0].slice(0, 70)}`)
        }
      }
    }
    expect(offenders, offenders.join("; ")).toEqual([])
  })

  test("no customer-facing page has a placeholder at all", () => {
    // A draft may have holes. A published page may not.
    const offenders: string[] = []
    for (const file of CUSTOMER_FACING) {
      if (/\[TO CONFIRM/.test(read(file))) offenders.push(file)
    }
    expect(offenders, `published pages with placeholders: ${offenders.join(", ")}`).toEqual([])
  })
})
