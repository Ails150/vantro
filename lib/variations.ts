// lib/variations.ts
//
// Variations and dayworks: references, money, and what can happen next.
//
// Pure, and safe to import from a client component -- the admin tab, the
// mobile API and the signing page all read labels and references from here, so
// "VO-003" means the same thing everywhere it is printed. The document hash,
// which needs node's crypto, lives in lib/variation-document.ts.
//
// MONEY IS PENCE INSIDE THIS FILE, as it is in lib/retention.ts. The columns
// are numeric pounds; 1150.10 * 100 is 115009.99999999999 in floating point,
// and that is the kind of number that ends up on a payment application. Every
// conversion rounds, once, here.

export type VariationKind = "variation" | "daywork"

export type VariationStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "sent"
  | "signed"
  | "declined"
  | "invoiced"

export const VARIATION_KINDS: VariationKind[] = ["variation", "daywork"]

/** Photos on one variation. Enough to show the before, the during and the after. */
export const MAX_VARIATION_PHOTOS = 6

/** How long a signing link lasts. A main contractor sits on paperwork; a week is too short. */
export const SHARE_EXPIRY_DAYS = 30

/**
 * The signing pad's drawing box. The page draws in it and the server refuses
 * any point outside it (lib/variation-document.ts strokesToSvg).
 */
export const PAD_W = 600
export const PAD_H = 200

export function toKind(value: unknown): VariationKind {
  return value === "daywork" ? "daywork" : "variation"
}

/** "VO-003", "DW-012". Three digits because nobody's job has a thousand. */
export function variationReference(kind: VariationKind | string | null | undefined, number: number | null | undefined): string {
  const prefix = kind === "daywork" ? "DW" : "VO"
  const n = Number(number)
  if (!Number.isInteger(n) || n < 1) return `${prefix}-???`
  return `${prefix}-${String(n).padStart(3, "0")}`
}

export function kindLabel(kind: VariationKind | string | null | undefined): string {
  return kind === "daywork" ? "Daywork" : "Variation"
}

export const STATUS_LABEL: Record<VariationStatus, string> = {
  pending: "Needs pricing",
  approved: "Approved, not sent",
  rejected: "Rejected",
  sent: "Awaiting signature",
  signed: "Signed",
  declined: "Declined by contractor",
  invoiced: "On payment application",
}

export function statusLabel(status: string | null | undefined): string {
  return STATUS_LABEL[status as VariationStatus] || "Unknown"
}

// ---------------------------------------------------------------------------
// What can happen next. The routes enforce these; the tab uses them to decide
// which buttons to draw, so the two cannot disagree.
// ---------------------------------------------------------------------------

/** Price and approve. A declined one can be re-priced and sent again. */
export function canApprove(status: string | null | undefined): boolean {
  return status === "pending" || status === "approved" || status === "declined" || status === "rejected"
}

export function canReject(status: string | null | undefined): boolean {
  return status === "pending" || status === "approved" || status === "declined"
}

/** Sent is included so a lost email can be re-sent; the old link is revoked. */
export function canSend(status: string | null | undefined): boolean {
  return status === "approved" || status === "sent"
}

export function canSign(status: string | null | undefined): boolean {
  return status === "sent"
}

/**
 * Money that has been agreed internally and is owed to us, but that nobody has
 * yet applied for. Approved, sent and signed all count: approval is the moment
 * the company decides the work is chargeable. Pending does not -- nobody has
 * priced it -- and invoiced is already on an application.
 */
export function isUnapplied(status: string | null | undefined): boolean {
  return status === "approved" || status === "sent" || status === "signed"
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/** numeric from PostgREST arrives as a string. Pounds in, integer pence out. */
export function toPence(pounds: number | string | null | undefined): number | null {
  if (pounds === null || pounds === undefined || pounds === "") return null
  const n = Number(pounds)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100)
}

export function penceToPounds(pence: number): number {
  return Math.round(pence) / 100
}

/**
 * Parse what somebody typed into a money box.
 *
 * Accepts "1250", "1,250.50", "£1,250.5". Returns pence, null for empty, or
 * undefined for something that is not money -- the caller refuses undefined
 * rather than storing a guess. More than two decimal places is refused, not
 * rounded: "12.345" is a typo, and rounding it silently picks an answer.
 */
export function parsePounds(raw: unknown): number | null | undefined {
  if (raw === null || raw === undefined) return null
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw < 0) return undefined
    return Math.round(raw * 100)
  }
  const s = String(raw).trim().replace(/^£/, "").replace(/,/g, "")
  if (s === "") return null
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return undefined
  const pence = Math.round(Number(s) * 100)
  // A single variation over ten million pounds is a typo, not a variation.
  if (pence > 1_000_000_000) return undefined
  return pence
}

/** Hours worked on it. Quarter-hour precision is what site timesheets use. */
export function parseHours(raw: unknown): number | null | undefined {
  if (raw === null || raw === undefined) return null
  const s = String(raw).trim()
  if (s === "") return null
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return undefined
  const n = Number(s)
  if (n > 10000) return undefined
  return n
}

/** £1,250.00. Always two decimals. */
export function formatPence(pence: number | null | undefined): string {
  const p = Number(pence) || 0
  return `£${(p / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Sum pence without ever touching a float. */
export function sumPence(values: Array<number | null | undefined>): number {
  let total = 0
  for (const v of values) if (typeof v === "number" && Number.isFinite(v)) total += Math.round(v)
  return total
}

/** A plausible email, which is as much as a form should check. */
export function looksLikeEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 320 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.trim())
}
