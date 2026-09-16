/**
 * RFC 9116 security.txt.
 *
 * The machine-readable half of /security. A researcher who finds something at
 * 11pm does not read a marketing page; their tooling fetches this path, and if
 * it 404s the next step is usually a tweet rather than an email.
 *
 * Served from a route rather than public/ for one reason: Expires is mandatory
 * under RFC 9116 and a stale one makes the whole file invalid. A static file
 * would need somebody to remember to edit a date. This computes it, so the file
 * cannot rot -- but it is deliberately a FIXED HORIZON from a review date
 * rather than "a year from now", because a date that is always twelve months
 * away is a date nobody ever revisits, which is the thing the field exists to
 * prevent.
 */

import { NextResponse } from "next/server"

/** Bump this when the page is actually reviewed. */
const LAST_REVIEWED = "2026-09-16"
const VALID_FOR_DAYS = 365

export const dynamic = "force-static"
export const revalidate = 86400

export function GET() {
  const expires = new Date(
    Date.parse(`${LAST_REVIEWED}T00:00:00Z`) + VALID_FOR_DAYS * 86400000,
  ).toISOString()

  const body = [
    "# Vantro security contact",
    "# https://app.getvantro.com/security",
    "",
    "Contact: mailto:security@getvantro.com",
    "Contact: https://app.getvantro.com/support",
    `Expires: ${expires}`,
    "Preferred-Languages: en",
    "Canonical: https://app.getvantro.com/.well-known/security.txt",
    "Policy: https://app.getvantro.com/security",
    "",
    "# Please test only against your own or a trial account, do not access",
    "# anyone else's data, and give us a reasonable chance to fix an issue",
    "# before publishing. We do not pursue researchers acting in good faith.",
    "",
  ].join("\n")

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  })
}
