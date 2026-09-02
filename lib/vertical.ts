// Per-vertical configuration. One object, read by everything that branches.
//
// `companies.vertical` is the only stored value; every difference a user sees
// between an install company and a cleaning company is looked up here. Nothing
// switches on a display string, only on the Vertical value itself.
//
// Scope: the noun for a field worker, the wizard's step one copy, and which
// admin tabs a vertical hides. Terminology beyond the worker noun lives in
// lib/terms.ts (VANTRO-VERTICALS-V1.md section 3) and is not this file's job.
//
// Adding a vertical is one entry below plus one value in the check constraint
// in migrations/20260902_companies_vertical.sql. Nothing else.

/** The stored values of companies.vertical. Matches the check constraint. */
export type Vertical =
  | "install" | "cleaning" | "security" | "facilities" | "grounds" | "pest"

/** Picker order. Install first: it is the default and the largest tenant set. */
export const VERTICALS: readonly Vertical[] =
  ["install", "cleaning", "security", "facilities", "grounds", "pest"]

/**
 * What an unknown, missing or not-yet-migrated vertical resolves to. Install
 * is today's wording and today's tab set, so falling back to it can never
 * blank a screen or hide a tab a company already uses.
 */
export const DEFAULT_VERTICAL: Vertical = "install"

/** Step one's question. Plain language, no jargon, sentence case. */
export const VERTICAL_QUESTION = "What does your team do?"

export type VerticalConfig = {
  value: Vertical
  /** Option label in the wizard picker. */
  label: string
  /** Option sub label: the trades or specialisms inside this vertical. */
  sublabel: string
  /** What this vertical calls one field worker, sentence-start case. */
  worker: string
  /** Plural, sentence-start case. */
  workers: string
  /** Mid-sentence singular. Stored, not lower-cased at the call site, so a
   *  vertical whose noun is a proper noun stays correct. */
  workerLower: string
  /** Mid-sentence plural. */
  workersLower: string
  /**
   * Admin tab ids this vertical does not show, by id in nav/tabs.ts.
   *
   * A hide list, not an allow list, and deliberately: a tab added to
   * nav/tabs.ts must appear for everyone until someone decides otherwise.
   * An allow list would silently hide every new tab from four verticals.
   */
  hiddenTabs: readonly string[]
}

export const VERTICAL_CONFIG: Record<Vertical, VerticalConfig> = {
  install: {
    value: "install",
    label: "Installation and trades",
    sublabel: "Glazing, solar, EV, roofing, heating",
    worker: "Installer",
    workers: "Installers",
    workerLower: "installer",
    workersLower: "installers",
    // Sites are the multi-site model an install company does not have: their
    // work is per job, at an address that belongs to the job.
    hiddenTabs: ["sites"],
  },
  cleaning: {
    value: "cleaning",
    label: "Cleaning",
    sublabel: "Commercial, contract, specialist",
    worker: "Operative",
    workers: "Operatives",
    workerLower: "operative",
    workersLower: "operatives",
    // Trades is construction's skill matrix. Everything below hides it.
    hiddenTabs: ["trades"],
  },
  security: {
    value: "security",
    label: "Security",
    sublabel: "Manned guarding, patrols, events",
    worker: "Officer",
    workers: "Officers",
    workerLower: "officer",
    workersLower: "officers",
    hiddenTabs: ["trades"],
  },
  facilities: {
    value: "facilities",
    label: "Facilities management",
    sublabel: "Maintenance, reactive callouts, planned works",
    // Engineer is the noun in VANTRO-VERTICALS-V1.md section 5, alongside
    // Visits and Faults. Only the worker noun is this file's to own.
    worker: "Engineer",
    workers: "Engineers",
    workerLower: "engineer",
    workersLower: "engineers",
    hiddenTabs: ["trades"],
  },
  grounds: {
    value: "grounds",
    label: "Grounds and landscaping",
    sublabel: "Maintenance, seasonal, gritting",
    worker: "Operative",
    workers: "Operatives",
    workerLower: "operative",
    workersLower: "operatives",
    hiddenTabs: ["trades"],
  },
  pest: {
    value: "pest",
    label: "Pest control",
    sublabel: "Commercial and domestic",
    worker: "Technician",
    workers: "Technicians",
    workerLower: "technician",
    workersLower: "technicians",
    hiddenTabs: ["trades"],
  },
}

/** True when a value is one this build knows. */
export function isVertical(value: unknown): value is Vertical {
  return typeof value === "string" && (VERTICALS as readonly string[]).includes(value)
}

/**
 * Coerce anything, a company row's column included, to a Vertical. A newer
 * server sending a value this build has never heard of must render the
 * install wording rather than crash or blank.
 */
export function toVertical(value: unknown): Vertical {
  return isVertical(value) ? value : DEFAULT_VERTICAL
}

/** The config for a vertical, or the install config when it is unrecognised. */
export function verticalConfig(value: unknown): VerticalConfig {
  return VERTICAL_CONFIG[toVertical(value)]
}

/** The six options in picker order, for rendering step one. */
export const VERTICAL_OPTIONS: readonly VerticalConfig[] = VERTICALS.map(v => VERTICAL_CONFIG[v])

/** Whether a tab id is shown to a given vertical. */
export function isTabVisible(tabId: string, vertical: unknown): boolean {
  return !verticalConfig(vertical).hiddenTabs.includes(tabId)
}

/**
 * Filter a nav array by vertical. Generic over the tab shape so nav/tabs.ts
 * owns the type and this file never imports it: config does not depend on nav.
 */
export function filterTabsByVertical<T extends { id: string }>(
  tabs: readonly T[],
  vertical: unknown,
): T[] {
  const { hiddenTabs } = verticalConfig(vertical)
  return tabs.filter(tab => !hiddenTabs.includes(tab.id))
}
