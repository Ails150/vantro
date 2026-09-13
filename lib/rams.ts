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
   */
  reason: "none_required" | "signed" | "unsigned" | "superseded"
  /** The version in force, when there is one. */
  rams: RamsDocument | null
  /** Set when they signed an earlier version, so the message can say so. */
  signedVersion: number | null
  /** Wording for the worker. Written here so every caller says the same thing. */
  message: string | null
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
  const open = (reason: RamsGate["reason"]): RamsGate => ({
    blocked: false, reason, rams: null, signedVersion: null, message: null,
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
    return open("none_required")
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
    return open("none_required")
  }
  if (signature) {
    return { blocked: false, reason: "signed", rams: current, signedVersion: current.version, message: null }
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
    message:
      priorVersion != null
        ? `The method statement for this job has been revised since you signed it ` +
          `(you signed version ${priorVersion}, version ${current.version} is now in force). ` +
          `Read and sign the new version before you sign in.`
        : `You need to read and sign the RAMS for this job before you can sign in: ` +
          `"${current.title}" (version ${current.version}).`,
  }
}
