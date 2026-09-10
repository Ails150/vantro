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
