// lib/schemes/homeowner-email.ts
//
// Tells the homeowner their installation has been registered and gives them the
// reference. It is deliberately NOT a certificate: the scheme issues that, and
// a Vantro document could be taken for it.
//
// A simulated registration never reaches a homeowner, whatever is on the job.
// It goes to SCHEME_TEST_EMAIL if set, and otherwise nowhere.

import { SCHEME_LABEL, type SchemeId } from "./driver"

export type HomeownerEmail = {
  jobId: string
  to: string | null
  companyName: string
  scheme: SchemeId
  propertyAddress: string
  certificateNumber: string
  simulated: boolean
}

export type EmailResult =
  | { status: "sent"; messageId: string | null; to: string }
  | { status: "failed"; reason: string }
  | { status: "skipped_simulator"; reason: string }

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

export function buildHomeownerEmail(e: HomeownerEmail) {
  const scheme = SCHEME_LABEL[e.scheme]
  const subject = `${e.simulated ? "[TEST] " : ""}Your installation has been registered with ${scheme}`
  const lines = [
    `${e.companyName} has registered the installation at ${e.propertyAddress} with ${scheme}.`,
    `Your reference is ${e.certificateNumber}.`,
    `Your official certificate comes from ${scheme}. Keep it safe, as you may need it when you sell the property. This email is confirmation only and is not the certificate.`,
  ]
  if (e.simulated) lines.unshift("TEST ONLY. Nothing has been registered with any scheme.")
  return {
    subject,
    text: lines.join("\n\n"),
    html: lines.map(l => `<p>${esc(l)}</p>`).join(""),
  }
}

export async function sendHomeownerConfirmation(
  e: HomeownerEmail,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<EmailResult> {
  let to = e.to?.trim() || ""
  if (e.simulated) {
    to = env.SCHEME_TEST_EMAIL?.trim() || ""
    if (!to) return { status: "skipped_simulator", reason: "Simulated registration, so no homeowner was emailed." }
  } else if (!to) {
    return { status: "failed", reason: "there is no homeowner email on this job." }
  }
  if (!env.RESEND_API_KEY) return { status: "failed", reason: "email is not configured." }

  const body = buildHomeownerEmail(e)
  const res = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      // A double tap on Retry cannot send two.
      "Idempotency-Key": `scheme-homeowner-${e.jobId}`,
    },
    body: JSON.stringify({ from: "Vantro <noreply@getvantro.com>", to: [to], ...body }),
    signal: AbortSignal.timeout(15000),
  })
  const text = await res.text()
  if (!res.ok) return { status: "failed", reason: `the email service refused it (${res.status}).` }
  let messageId: string | null = null
  try { messageId = JSON.parse(text).id || null } catch {}
  return { status: "sent", messageId, to }
}
