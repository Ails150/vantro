// lib/rams.ts
//
// One place that answers "may this person start work on this job".
//
// The gate is consulted by /api/signin, which refuses, and by the installer
// RAMS endpoint and the job screen, which explain. Those three must never
// disagree: a worker told they are clear to sign in and then refused at the
// door is worse than either answer on its own.
//
// The question is always about the CURRENT version. A signature on v1 does not
// clear v2 — that is the whole reason rams_documents is versioned — so a
// revision correctly puts the whole crew back to unsigned, and they are told
// why rather than being handed a generic refusal.

type Service = any

export type RamsDocument = {
  id: string
  version: number
  title: string
  document_url: string
  document_path: string
  document_sha256: string
  notes: string | null
  created_at: string
}

export type RamsGate = {
  /** True when sign-in must be refused. */
  blocked: boolean
  /**
   * Why, as a stable code:
   *   none_required     no RAMS has been uploaded for this job
   *   signed            they have signed the version in force
   *   unsigned          a RAMS is in force and they have not signed it
   *   superseded        they signed an earlier version; this one is new
   *   skipped_error     the gate could not be evaluated and let them through
   */
  reason: "none_required" | "signed" | "unsigned" | "superseded" | "skipped_error"
  /** The version in force, when there is one. */
  rams: RamsDocument | null
  /** Set when they signed an earlier version, so the message can say so. */
  signedVersion: number | null
  /** Wording for the worker. Written here so every caller says the same thing. */
  message: string | null
  /**
   * What to stamp on signins.rams_check. Only the three terminal states are
   * recordable: an `unsigned` or `superseded` gate never produces a sign-in
   * row, because it refuses.
   */
  checkOutcome: "signed" | "none_required" | "skipped_error"
  /** The database error, when the gate failed open. The caller alerts on it. */
  lookupError: string | null
}

const FIELDS =
  "id, version, title, document_url, document_path, document_sha256, notes, created_at"

/**
 * Resolve the gate for one worker on one job.
 *
 * Fails OPEN on a database error, deliberately, and says so in the logs. This
 * is the one judgement call in the file and it is worth stating: if the RAMS
 * lookup itself breaks, refusing every sign-in on the platform turns a read
 * error into a total stoppage across every site. A missed signature is
 * recoverable and visible in the admin list; a company that cannot start work
 * is not. The failure is logged loudly so it does not sit unnoticed.
 */
export async function getRamsGate(
  service: Service,
  jobId: string,
  userId: string,
): Promise<RamsGate> {
  const open = (reason: "none_required" | "skipped_error", lookupError: string | null = null): RamsGate => ({
    blocked: false,
    reason,
    rams: null,
    signedVersion: null,
    message: null,
    checkOutcome: reason,
    lookupError,
  })

  const { data: current, error } = await service
    .from("rams_documents")
    .select(FIELDS)
    .eq("job_id", jobId)
    .is("superseded_at", null)
    .is("archived_at", null)
    .maybeSingle()

  if (error) {
    console.error("[rams] gate lookup failed - allowing sign-in", { jobId, userId, error: error.message })
    return open("skipped_error", error.message)
  }
  if (!current) return open("none_required")

  const { data: signature, error: sigErr } = await service
    .from("rams_signatures")
    .select("id, signed_at")
    .eq("rams_id", current.id)
    .eq("user_id", userId)
    .maybeSingle()

  if (sigErr) {
    console.error("[rams] signature lookup failed - allowing sign-in", { jobId, userId, error: sigErr.message })
    return open("skipped_error", sigErr.message)
  }
  if (signature) {
    return {
      blocked: false, reason: "signed", rams: current,
      signedVersion: current.version, message: null,
      checkOutcome: "signed", lookupError: null,
    }
  }

  // Did they sign an older version? Changes the wording, not the outcome.
  const { data: previous } = await service
    .from("rams_signatures")
    .select("rams_documents!inner(job_id, version)")
    .eq("user_id", userId)
    .eq("rams_documents.job_id", jobId)
    .order("signed_at", { ascending: false })
    .limit(1)

  const priorVersion = (previous || [])[0]?.rams_documents?.version ?? null

  return {
    blocked: true,
    reason: priorVersion != null ? "superseded" : "unsigned",
    rams: current,
    signedVersion: priorVersion,
    // Never reached by a sign-in row: this gate refuses, so nothing is stamped.
    checkOutcome: "signed",
    lookupError: null,
    message:
      priorVersion != null
        ? `The method statement for this job has been revised since you signed it ` +
          `(you signed version ${priorVersion}, version ${current.version} is now in force). ` +
          `Read and sign the new version before you sign in.`
        : `You need to read and sign the RAMS for this job before you can sign in: ` +
          `"${current.title}" (version ${current.version}).`,
  }
}


/**
 * Raise an admin alert that the RAMS gate is failing open, at most once per
 * company per hour.
 *
 * Rate limited because the failure mode is a broken lookup, which means EVERY
 * sign-in attempt across the company hits it. An alert per attempt would bury
 * the one thing the admin needs to see under a hundred copies of itself, on the
 * morning when everybody signs in at once.
 *
 * The window is enforced by reading the last alert of this type rather than by
 * a counter, so it survives a cold start and does not need any shared state.
 * Best effort throughout: an alert that cannot be raised must never stop
 * someone starting work, which is the whole reason the gate fails open.
 */
export async function alertRamsGateFailure(
  service: Service,
  companyId: string,
  detail: string,
): Promise<void> {
  const ALERT_TYPE = "rams_gate_error"
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  try {
    const { data: recent } = await service
      .from("alerts")
      .select("id")
      .eq("company_id", companyId)
      .eq("alert_type", ALERT_TYPE)
      .gte("created_at", oneHourAgo)
      .limit(1)
    if (recent && recent.length > 0) return

    await service.from("alerts").insert({
      company_id: companyId,
      alert_type: ALERT_TYPE,
      message:
        "RAMS checks are failing, so sign-in is not being gated. Workers can start " +
        "on jobs whose method statement they have not signed until this is fixed. " +
        "Details: " + detail.slice(0, 300),
      status: "open",
      urgency: 3,
      is_read: false,
    })
    console.error("[rams] gate failure alert raised for company", companyId)
  } catch (e: any) {
    console.error("[rams] could not raise gate failure alert", e?.message)
  }
}
