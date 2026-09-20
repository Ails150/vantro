// Helpers shared by the two paths that create a company.
//
// There are two: the Stripe checkout webhook (paid) and the signup route
// (free). They must produce the same shape of row, or an upgrade from free
// becomes a migration instead of a plan change. These lived as private copies
// inside the webhook; a second copy in the signup route is exactly how the two
// would drift.

export function generateSlug(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  const suffix = Math.random().toString(36).slice(2, 6)
  return `${base || 'co'}-${suffix}`
}

/**
 * A company name from an email address, for a signup that no longer asks.
 *
 * "dan@barrowglazing.co.uk" -> "Barrow Glazing". Public mailbox domains carry
 * no information about the business, so those fall back to the local part:
 * "dan.mercer@gmail.com" -> "Dan Mercer". It is a placeholder with a rename
 * button on it, not a guess presented as fact -- the dashboard asks them to
 * confirm it the first time they open a screen with their name on it.
 */
const PUBLIC_MAILBOXES = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'hotmail.co.uk',
  'live.co.uk', 'live.com', 'yahoo.com', 'yahoo.co.uk', 'icloud.com', 'me.com',
  'aol.com', 'btinternet.com', 'sky.com', 'talktalk.net', 'virginmedia.com',
  'protonmail.com', 'proton.me', 'msn.com', 'mail.com', 'gmx.com',
])

export function companyNameFromEmail(email: string): string {
  const raw = String(email || '').trim().toLowerCase()
  const at = raw.lastIndexOf('@')
  if (at < 1) return 'My company'
  const local = raw.slice(0, at)
  const domain = raw.slice(at + 1)
  const titled = (value: string) =>
    value
      .replace(/[._+-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, c => c.toUpperCase())

  if (!domain || PUBLIC_MAILBOXES.has(domain)) {
    return titled(local) || 'My company'
  }
  // Drop the public suffix: co.uk, com, ltd.uk and friends carry no name.
  const parts = domain.split('.')
  const name = parts.length > 2 && parts[parts.length - 2] === 'co' ? parts.slice(0, -2) : parts.slice(0, -1)
  return titled(name.join(' ')) || titled(local) || 'My company'
}

export function getInitials(name: string): string {
  return name.trim().split(/\s+/).map(p => p[0] || '').join('').toUpperCase().slice(0, 2)
}

/** Mon-Fri 08:00-17:00. What a company gets before anyone edits it. */
export function defaultSchedule() {
  return {
    mon: { enabled: true, start: "08:00", end: "17:00" },
    tue: { enabled: true, start: "08:00", end: "17:00" },
    wed: { enabled: true, start: "08:00", end: "17:00" },
    thu: { enabled: true, start: "08:00", end: "17:00" },
    fri: { enabled: true, start: "08:00", end: "17:00" },
    sat: { enabled: false },
    sun: { enabled: false },
  }
}
