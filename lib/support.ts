// lib/support.ts
//
// Who a customer talks to, and how, decided by what they pay.
//
// Paid customers get a person: a WhatsApp thread with a name on it, and an
// email address. Free customers get the help centre. That is the difference
// being sold, so it is stated in one place rather than inferred from a plan
// check scattered through the UI.
//
// Read on the server and passed down as a prop. The number and addresses are
// public contact details, not secrets -- they are in the rendered page either
// way -- but reading them here keeps the env names off the client and means an
// unset variable degrades in one place instead of printing "undefined" into a
// link.

import { atLeast, type Plan } from "./plan"

/** Digits only, as wa.me requires: no +, no spaces, no brackets. */
function waNumber(raw: string | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, "")
  // A wa.me link needs a full international number. Anything shorter than a
  // plausible country code plus subscriber number is a misconfiguration, and a
  // broken link is worse than no link at all.
  return digits.length >= 8 ? digits : null
}

export type SupportContacts = {
  /** wa.me URL, or null when SUPPORT_WHATSAPP is unset or unusable. */
  whatsappUrl: string | null
  /** The name on the WhatsApp thread, so it reads as a person. */
  whatsappName: string
  email: string
  /** Where free companies are sent. Falls back to the in-app Support tab. */
  helpUrl: string | null
}

export function getSupportContacts(): SupportContacts {
  const number = waNumber(process.env.SUPPORT_WHATSAPP)
  return {
    whatsappUrl: number ? `https://wa.me/${number}` : null,
    whatsappName: process.env.SUPPORT_WHATSAPP_NAME || "Aileen",
    email: process.env.SUPPORT_EMAIL || "support@getvantro.com",
    // No invented URL: unset means the Billing tab points at the in-app
    // Support tab, which exists, rather than at a page that may not.
    helpUrl: process.env.SUPPORT_HELP_URL || null,
  }
}

/** Paid plans get a human. Free gets the help centre. */
export function hasHumanSupport(plan: Plan): boolean {
  return atLeast(plan, "payroll")
}
