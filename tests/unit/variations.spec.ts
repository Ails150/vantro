import { test, expect } from "@playwright/test"
import {
  canApprove,
  canReject,
  canSend,
  formatPence,
  isUnapplied,
  parseHours,
  parsePounds,
  sumPence,
  toPence,
  variationReference,
} from "../../lib/variations"
import {
  canonicalJson,
  documentSha256,
  hashShareToken,
  isWellFormedToken,
  newShareToken,
  strokesToSvg,
  type VariationDocument,
} from "../../lib/variation-document"

/**
 * A variation's price ends up on a payment application and its hash ends up
 * under somebody's signature. Both have to be exactly right, so both are
 * pinned here.
 */

test.describe("references", () => {
  test("variations and dayworks are numbered apart", () => {
    expect(variationReference("variation", 3)).toBe("VO-003")
    expect(variationReference("daywork", 12)).toBe("DW-012")
    expect(variationReference("variation", 1234)).toBe("VO-1234")
  })
  test("a missing number is visible, not invented", () => {
    expect(variationReference("variation", null)).toBe("VO-???")
    expect(variationReference("daywork", 0)).toBe("DW-???")
  })
})

test.describe("money is pence", () => {
  test("the float that would otherwise reach the application", () => {
    // 1150.10 * 100 is 115009.99999999999 in binary floating point.
    expect(toPence(1150.1)).toBe(115010)
    expect(toPence("1150.10")).toBe(115010)
    expect(toPence("0.29")).toBe(29)
  })
  test("null stays null, not zero", () => {
    expect(toPence(null)).toBeNull()
    expect(toPence("")).toBeNull()
    expect(toPence(undefined)).toBeNull()
  })
  test("sums never touch a float", () => {
    expect(sumPence([115010, 42050, null, 29])).toBe(157089)
    expect(formatPence(157089)).toBe("£1,570.89")
  })
})

test.describe("what a person types into a money box", () => {
  test("accepted", () => {
    expect(parsePounds("1250")).toBe(125000)
    expect(parsePounds("1,250.50")).toBe(125050)
    expect(parsePounds("£1,250.5")).toBe(125050)
    expect(parsePounds(420)).toBe(42000)
  })
  test("empty is null", () => {
    expect(parsePounds("")).toBeNull()
    expect(parsePounds("  ")).toBeNull()
    expect(parsePounds(null)).toBeNull()
  })
  test("refused rather than guessed", () => {
    expect(parsePounds("12.345")).toBeUndefined()
    expect(parsePounds("-5")).toBeUndefined()
    expect(parsePounds("twelve")).toBeUndefined()
    expect(parsePounds("1e5")).toBeUndefined()
    expect(parsePounds("99999999999")).toBeUndefined()
    expect(parsePounds(-1)).toBeUndefined()
  })
  test("hours", () => {
    expect(parseHours("3.5")).toBe(3.5)
    expect(parseHours("")).toBeNull()
    expect(parseHours("3h")).toBeUndefined()
    expect(parseHours("20000")).toBeUndefined()
  })
})

test.describe("what can happen next", () => {
  test("only an approved or already-sent variation can be sent", () => {
    expect(canSend("approved")).toBe(true)
    expect(canSend("sent")).toBe(true)
    for (const s of ["pending", "signed", "invoiced", "declined", "rejected"]) expect(canSend(s)).toBe(false)
  })
  test("a signed variation cannot be re-priced or rejected", () => {
    expect(canApprove("signed")).toBe(false)
    expect(canApprove("invoiced")).toBe(false)
    expect(canApprove("sent")).toBe(false)
    expect(canReject("signed")).toBe(false)
  })
  test("a declined one can be re-priced", () => {
    expect(canApprove("declined")).toBe(true)
  })
  test("unapplied money is approved, sent or signed", () => {
    expect(["approved", "sent", "signed"].every(isUnapplied)).toBe(true)
    expect(["pending", "rejected", "declined", "invoiced"].some(isUnapplied)).toBe(false)
  })
})

function doc(overrides: Partial<VariationDocument> = {}): VariationDocument {
  return {
    v: 1,
    company: { id: "c1", name: "Holts" },
    job: { id: "j1", name: "Eddington Court", address: "1 High St", contractor: "Kier" },
    variation: {
      id: "v1",
      reference: "VO-001",
      kind: "variation",
      description: "Move the mullion",
      labourHours: 3.5,
      materials: "2 mullions",
      raisedBy: "Marcus",
      raisedAt: "2026-09-19T09:00:00.000Z",
      estimatePence: 42000,
      captureSha256: "a".repeat(64),
    },
    photos: [{ path: "variations/c1/j1/abc.jpg", sha256: "b".repeat(64) }],
    pricePence: 115010,
    currency: "GBP",
    sentTo: "qs@kier.example",
    ...overrides,
  }
}

test.describe("the signed document", () => {
  test("canonical form sorts keys at every depth", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null } })).toBe('{"a":{"c":null,"d":[2,1]},"b":1}')
  })
  test("the same document hashes the same however it was built", () => {
    const a = doc()
    const b = JSON.parse(JSON.stringify(doc())) as VariationDocument
    // Rebuild with keys in a different order.
    const reordered = { sentTo: b.sentTo, currency: b.currency, pricePence: b.pricePence, photos: b.photos, variation: b.variation, job: b.job, company: b.company, v: b.v }
    expect(documentSha256(a)).toBe(documentSha256(reordered as VariationDocument))
    expect(documentSha256(a)).toMatch(/^[0-9a-f]{64}$/)
  })
  test("changing the price changes the hash -- this is what binds the signature to a figure", () => {
    expect(documentSha256(doc())).not.toBe(documentSha256(doc({ pricePence: 115011 })))
  })
  test("changing the site record changes the hash", () => {
    const d = doc()
    const tampered = doc({ variation: { ...d.variation, captureSha256: "c".repeat(64) } })
    expect(documentSha256(d)).not.toBe(documentSha256(tampered))
  })
  test("a pinned hash, so a recipe change cannot slip past unnoticed", () => {
    // If this changes, DOCUMENT_VERSION must be bumped: every signature ever
    // recorded was checked against the old recipe.
    expect(documentSha256(doc())).toBe(PINNED)
  })
})

const PINNED = "7dd92dabd801f58182831324ad798c309d0a18ed5e9263242909f4489d88bb63"

test.describe("share tokens", () => {
  test("43 url-safe characters, stored only as a hash", () => {
    const t = newShareToken()
    expect(isWellFormedToken(t)).toBe(true)
    expect(hashShareToken(t)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashShareToken(t)).not.toContain(t)
  })
  test("malformed tokens are refused before any query", () => {
    expect(isWellFormedToken("abc")).toBe(false)
    expect(isWellFormedToken("'; drop table variation_shares; --".padEnd(43, "x"))).toBe(false)
    expect(isWellFormedToken(null)).toBe(false)
  })
})

test.describe("signatures are drawn by the server", () => {
  const line: Array<[number, number]> = Array.from({ length: 10 }, (_, i) => [10 + i * 20, 100])
  test("strokes become an SVG data URI we wrote", () => {
    const svg = strokesToSvg([line])!
    expect(svg.startsWith("data:image/svg+xml;base64,")).toBe(true)
    const decoded = Buffer.from(svg.split(",")[1], "base64").toString("utf8")
    expect(decoded).toContain('<path d="M10.0 100.0 L30.0 100.0')
    expect(decoded).not.toMatch(/script|href|onload/i)
  })
  test("a dot is not a signature", () => {
    expect(strokesToSvg([[[5, 5]]])).toBeNull()
    expect(strokesToSvg([])).toBeNull()
  })
  test("anything that is not a number in the pad is refused, not escaped", () => {
    expect(strokesToSvg([[...line, ['"/><script>', 1] as any]])).toBeNull()
    expect(strokesToSvg([[...line, [9999, 1]]])).toBeNull()
    expect(strokesToSvg("<svg onload=alert(1)>")).toBeNull()
  })
})
