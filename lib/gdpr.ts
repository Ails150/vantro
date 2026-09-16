// lib/gdpr.ts
//
// What counts as one worker's personal data, and what erasing them means.
//
// The map below is the heart of both features. An export that misses a table is
// an incomplete Article 15 response; an anonymisation that misses one leaves a
// name behind after somebody has been told it was removed. Both are worse than
// not offering the feature, so the map is written out explicitly rather than
// discovered at runtime, and the tests assert its shape.

/**
 * Every table holding rows about a worker, and the column that points at them.
 *
 * `label` is what the export calls the section -- a worker reading their own
 * data should not have to know that "signins" means "the times you started and
 * finished work".
 *
 * `anonymise` says what happens on erasure:
 *   "keep"    the row stays, untouched. It no longer identifies anybody once
 *             users.name is a pseudonym, because it points at the user by id.
 *   "detach"  the row stays but the pointer is nulled -- used where the column
 *             is an ADMIN's id on somebody else's record.
 *   "delete"  the row is genuinely removed. Only for rows that are purely
 *             operational and hold no evidential value.
 */
export type SubjectTable = {
  table: string
  column: string
  label: string
  anonymise: "keep" | "detach" | "delete"
  /** Why, for the tables where the choice is not obvious. */
  note?: string
}

export const SUBJECT_TABLES: SubjectTable[] = [
  // --- Evidence. All kept: these prove a site was manned and briefed, which
  // --- is a fact about the company as well as about the person.
  {
    table: "signins", column: "user_id", label: "Shifts you signed in and out of",
    anonymise: "keep",
    note: "Attendance is a health and safety record. Article 17(3) exempts it.",
  },
  {
    table: "location_logs", column: "user_id", label: "Location pings while signed in",
    anonymise: "keep",
    note: "Hashed into the evidence chain in batches; removing rows breaks a merkle root.",
  },
  {
    table: "diary_entries", column: "user_id", label: "Site diary entries you wrote",
    anonymise: "keep",
  },
  {
    table: "qa_submissions", column: "user_id", label: "Quality checks you submitted",
    anonymise: "keep",
    note: "A client may rely on these years later.",
  },
  {
    table: "defects", column: "user_id", label: "Defects you raised",
    anonymise: "keep",
  },
  {
    table: "walkthroughs", column: "user_id", label: "Voice walkthroughs you recorded",
    anonymise: "keep",
  },
  {
    table: "variations", column: "raised_by", label: "Variations you raised",
    anonymise: "keep",
  },
  {
    table: "incidents", column: "reported_by", label: "Incidents you reported",
    anonymise: "keep",
    note: "A worker's account of an incident is immutable at the database level.",
  },
  {
    table: "rams_signatures", column: "user_id", label: "Method statements you signed",
    anonymise: "keep",
    note: "Proof the RAMS was briefed before work started.",
  },
  {
    table: "toolbox_talk_signatures", column: "user_id", label: "Safety briefings you signed",
    anonymise: "keep",
  },
  {
    table: "expenses", column: "user_id", label: "Expenses you claimed",
    anonymise: "keep",
    note: "A financial record with its own retention obligation.",
  },

  // --- Scheduling and operational. No evidential weight once the person has
  // --- gone, and they are about the future rather than the past.
  {
    table: "time_off_entries", column: "user_id", label: "Time off you booked",
    anonymise: "delete",
  },
  {
    table: "leave_allowances", column: "user_id", label: "Your holiday allowance",
    anonymise: "delete",
  },
  {
    table: "user_shifts", column: "user_id", label: "Your working pattern",
    anonymise: "delete",
  },
  {
    table: "job_assignments", column: "user_id", label: "Jobs you were assigned to",
    anonymise: "delete",
    note: "Who was ASSIGNED is superseded by signins, which record who actually attended.",
  },
  {
    table: "visit_assignments", column: "user_id", label: "Visits you were scheduled for",
    anonymise: "delete",
  },
  {
    table: "notification_log", column: "user_id", label: "Notifications sent to you",
    anonymise: "delete",
    note: "A delivery log about a person who has asked to be forgotten.",
  },
  {
    table: "pay_bonuses", column: "user_id", label: "Bonuses and deductions",
    anonymise: "keep",
    note: "Payroll. Kept for the same reason expenses are.",
  },

  // --- Rows where the column is this person acting ON somebody else's record.
  // --- The record belongs to the other party, so it stays and the pointer goes.
  {
    table: "qa_submissions", column: "reviewed_by", label: "Quality checks you reviewed",
    anonymise: "detach",
  },
  {
    table: "incidents", column: "acknowledged_by", label: "Incidents you acknowledged",
    anonymise: "detach",
  },
  {
    table: "incidents", column: "closed_by", label: "Incidents you closed",
    anonymise: "detach",
  },
  {
    table: "audit_log", column: "user_id", label: "Administrative actions you took",
    anonymise: "detach",
    note: "The action happened and stays; who did it becomes an id with no name.",
  },
]

/** The columns on users itself that carry identity. */
export const IDENTITY_COLUMNS = [
  "name", "email", "phone", "initials", "pin_hash", "auth_user_id",
  "address", "emergency_contact", "emergency_phone", "national_insurance_number",
  "date_of_birth", "push_token", "avatar_url",
] as const

/**
 * The replacement name.
 *
 * Deliberately stable and derived from the id rather than random: two lists
 * showing the same anonymised worker must show the same label, or an admin
 * reading a rota and a payroll export cannot tell they are looking at one
 * person. It carries no information about who they were.
 *
 * "Former worker" rather than "Anonymised" or "Deleted" because it is what an
 * admin actually needs to understand when the name turns up on an old record.
 */
export function pseudonymFor(userId: string): string {
  const suffix = String(userId || "").replace(/-/g, "").slice(0, 6).toUpperCase()
  return `Former worker ${suffix || "UNKNOWN"}`
}

/**
 * The users-row patch that erases an identity.
 *
 * is_active false and no credentials, which the check constraint in
 * 20260916100000_data_subject_rights.sql also enforces: a PIN left on an
 * anonymised row is a live credential belonging to somebody who asked to be
 * forgotten.
 */
export function anonymisePatch(userId: string, actionedBy: string | null) {
  return {
    name: pseudonymFor(userId),
    email: null,
    phone: null,
    initials: "--",
    pin_hash: null,
    auth_user_id: null,
    is_active: false,
    anonymised_at: new Date().toISOString(),
    anonymised_by: actionedBy,
  }
}

/** Tables whose rows are removed outright on erasure. */
export function tablesToDelete(): SubjectTable[] {
  return SUBJECT_TABLES.filter(t => t.anonymise === "delete")
}

/** Tables where this person's pointer is nulled but the row stays. */
export function tablesToDetach(): SubjectTable[] {
  return SUBJECT_TABLES.filter(t => t.anonymise === "detach")
}

/** Tables read for an Article 15 export. All of them, whatever happens on erasure. */
export function tablesToExport(): SubjectTable[] {
  return SUBJECT_TABLES
}

/**
 * The limits of what erasure can reach, stated for the UI and the export.
 *
 * Shown to the admin BEFORE they confirm, because a person told their data was
 * erased and later finding their name on a PDF has been misled, and the company
 * that told them carries that.
 */
export const ERASURE_CAVEATS = [
  "Audit packs already issued keep the name that was in them. They are signed and hashed, and rewriting one would break the signature that makes it worth anything.",
  "Shift, safety and quality records are kept with the name removed. They are health and safety evidence, which UK GDPR Article 17(3) exempts from erasure.",
  "Backups roll off on their own retention schedule and are not rewritten in place.",
] as const
