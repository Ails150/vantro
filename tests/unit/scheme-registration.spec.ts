import { test, expect } from "@playwright/test"
import crypto from "crypto"
import { open, seal } from "../../lib/secret-box"
import { createSimulator, schemeAvailability, schemeFeatureEnabled } from "../../lib/schemes/driver"
import { buildHomeownerEmail, sendHomeownerConfirmation } from "../../lib/schemes/homeowner-email"
import {
  connectionContext,
  needsAttention,
  registerJob,
  registrationDeadline,
  type NewRegistration,
  type SchemeJob,
  type SchemeStore,
} from "../../lib/schemes/register"

/**
 * THE WORKED EXAMPLE. One test job, end to end, through the same registerJob
 * that sign-off and Retry call. The simulator stands in for the scheme and an
 * in-memory store for Supabase. What the SQL itself guarantees is exercised
 * against the migration separately (see docs/schemes/WORKED-EXAMPLE.md).
 */

const COMPANY = "11111111-1111-1111-1111-111111111111"
const JOB = "22222222-2222-2222-2222-222222222222"
const env = { SCHEME_KEY_ENCRYPTION_KEY: crypto.randomBytes(32).toString("base64"), RESEND_API_KEY: "re_test", SCHEME_SIM_COMPANIES: `other, ${COMPANY}` }

function testJob(over: Partial<SchemeJob> = {}): SchemeJob {
  return {
    id: JOB, company_id: COMPANY, name: "14 Test Road windows", status: "completed", notifiable: true,
    scheme: "fensa", property_address: "14 Test Road, Belfast", work_type: "Replacement windows",
    windows_count: 6, doors_count: 1, completion_date: "2026-11-02", homeowner_name: "A Homeowner",
    homeowner_email: "homeowner@example.com", certificate_number: null, registration_status: "pending",
    registration_error: null, registration_attempted_at: null, registration_environment: null,
    homeowner_email_status: "not_sent", homeowner_email_error: null, homeowner_email_attempted_at: null,
    ...over,
  }
}

function memoryStore(job: SchemeJob, plan = "suite") {
  const registrations: NewRegistration[] = []
  const store: SchemeStore = {
    loadJob: async () => job,
    loadCompany: async () => ({ name: "Test Glazing Ltd", plan }),
    loadConnection: async (c, s) => ({
      api_key_encrypted: seal("sim_test_key", connectionContext(c, s), env),
      member_number: "M1234",
      active: true,
    }),
    claim: async (_c, _j, afterManualCheck) => {
      const s = job.registration_status
      if (s === "pending" || s === "failed" || (s === "unknown" && afterManualCheck)) {
        job.registration_status = "registering"
        job.registration_error = null
        return { claimed: true, status: "registering" }
      }
      return { claimed: false, status: s }
    },
    insertRegistration: async row => {
      const existing = registrations.find(r => r.job_id === row.job_id)
      if (existing) return { certificateNumber: existing.certificate_number }
      registrations.push(row)
      return { certificateNumber: row.certificate_number }
    },
    markRegistered: async (_j, cert, environment) => {
      job.registration_status = "registered"
      job.certificate_number = cert
      job.registration_environment = environment
    },
    markProblem: async (_j, status, reason) => {
      job.registration_status = status
      job.registration_error = reason
    },
    claimEmail: async () => {
      if (!["not_sent", "failed"].includes(job.homeowner_email_status)) return false
      job.homeowner_email_status = "sending"
      return true
    },
    markEmail: async (_j, status, reason) => {
      job.homeowner_email_status = status
      job.homeowner_email_error = reason
    },
  }
  return { store, registrations }
}

function harness(job: SchemeJob, plan = "suite") {
  const { store, registrations } = memoryStore(job, plan)
  const driver = createSimulator()
  const calls = { register: 0 }
  const counted = { ...driver, register: (r: any, k: string) => { calls.register++; return driver.register(r, k) } }
  const deps = {
    store,
    env,
    availability: () => ({ available: true as const, driver: counted }),
    sendEmail: ((e: any, _env?: any) => sendHomeownerConfirmation(e, env)) as typeof sendHomeownerConfirmation,
  }
  const run = (afterManualCheck = false) =>
    registerJob(deps, { companyId: COMPANY, jobId: JOB, actorUserId: null, afterManualCheck })
  return { run, calls, driver, registrations }
}

test.describe("worked example: one test job, end to end", () => {
  test("sign-off registers it, stores the number, and a repeat does nothing", async () => {
    const job = testJob()
    const { run, calls, registrations } = harness(job)

    const first = await run()
    expect(first.status).toBe("registered")
    expect(first.certificateNumber).toMatch(/^SIM-FENSA-[0-9A-F]{10}$/)
    expect(job.certificate_number).toBe(first.certificateNumber)
    expect(registrations).toHaveLength(1)
    expect(registrations[0]).not.toHaveProperty("homeowner_email")
    expect(needsAttention(job)).toBeNull()

    // Double tap, a second sign-off, a stale Retry.
    await run()
    await run()
    expect(calls.register).toBe(1)
    expect(registrations).toHaveLength(1)
  })

  test("a simulated registration never emails the homeowner", async () => {
    const job = testJob()
    const { run } = harness(job)
    const outcome = await run()
    expect(outcome.email?.status).toBe("skipped_simulator")
    expect(job.homeowner_email_status).toBe("skipped_simulator")
  })

  test("a refusal shows on Today with the reason, and Retry succeeds once fixed", async () => {
    const job = testJob({ property_address: "SIM-REJECT" })
    const { run, calls } = harness(job)

    expect((await run()).status).toBe("failed")
    const item = needsAttention(job)!
    expect(item.kind).toBe("failed")
    expect(item.reason).toContain("FENSA refused this job")
    expect(item.needsPortalCheck).toBe(false)
    expect(item.deadline).toBe("2026-11-23")

    job.property_address = "14 Test Road, Belfast"
    expect((await run()).status).toBe("registered")
    expect(calls.register).toBe(2)
  })

  test("a timeout cannot be retried until someone has checked the portal", async () => {
    const job = testJob({ property_address: "SIM-TIMEOUT" })
    const { run, calls, driver } = harness(job)

    expect((await run()).status).toBe("unknown")
    expect(driver.accepted.size).toBe(1) // the scheme has it, and we do not know
    expect(needsAttention(job)!.needsPortalCheck).toBe(true)

    expect((await run()).status).toBe("needs_check")
    expect(calls.register).toBe(1)

    job.property_address = "14 Test Road, Belfast"
    expect((await run(true)).status).toBe("registered")
    expect(calls.register).toBe(2)
  })
})

test.describe("nothing fails silently", () => {
  test("missing details are all named, and the scheme is not called", async () => {
    const job = testJob({ scheme: "fensa", property_address: " ", windows_count: 0, doors_count: 0, completion_date: null })
    const { run, calls } = harness(job)
    const outcome = await run()
    expect(outcome.status).toBe("failed")
    expect(outcome.reason).toBe("Add the property address, number of windows or doors, completion date to this job.")
    expect(calls.register).toBe(0)
  })

  test("below Full Suite it fails with the reason and never calls the scheme", async () => {
    const job = testJob()
    const { run, calls } = harness(job, "payroll")
    expect((await run()).reason).toContain("Full Suite")
    expect(calls.register).toBe(0)
  })

  test("a driver that throws is unknown, not failed", async () => {
    const job = testJob()
    const { store } = memoryStore(job)
    const thrower = { ...createSimulator(), register: async () => { throw new Error("socket hang up") } }
    const outcome = await registerJob(
      { store, env, availability: () => ({ available: true, driver: thrower }) },
      { companyId: COMPANY, jobId: JOB, actorUserId: null },
    )
    expect(outcome.status).toBe("unknown")
  })

  test("accepted but not saved keeps the number and warns against registering again", async () => {
    const job = testJob()
    const { store } = memoryStore(job)
    store.insertRegistration = async () => { throw new Error("db down") }
    const outcome = await registerJob(
      { store, env, availability: () => ({ available: true, driver: createSimulator() }) },
      { companyId: COMPANY, jobId: JOB, actorUserId: null },
    )
    expect(outcome.status).toBe("unknown")
    expect(job.registration_error).toContain("SIM-FENSA-")
    expect(job.registration_error).toContain("Do not register it again")
  })

  test("signed off but never attempted is on Today, an open job is not", () => {
    expect(needsAttention(testJob())!.kind).toBe("not_attempted")
    expect(needsAttention(testJob({ status: "active" }))).toBeNull()
  })

  test("a registration stuck mid-flight is on Today as unknown", () => {
    const now = new Date("2026-11-09T12:00:00Z")
    expect(needsAttention(testJob({ registration_status: "registering", registration_attempted_at: "2026-11-09T11:59:00Z" }), now)).toBeNull()
    expect(needsAttention(testJob({ registration_status: "registering", registration_attempted_at: "2026-11-09T11:50:00Z" }), now)!.needsPortalCheck).toBe(true)
  })

  test("a failed homeowner email is on Today", () => {
    const item = needsAttention(testJob({
      registration_status: "registered", homeowner_email_status: "failed", homeowner_email_error: "there is no homeowner email on this job.",
    }))!
    expect(item.kind).toBe("email")
    expect(item.reason).toContain("no homeowner email")
  })
})

test.describe("real registration cannot happen by accident", () => {
  test("live mode reaches nothing, because no live driver exists", () => {
    expect(schemeAvailability("fensa", COMPANY, { SCHEME_MODE: "live" }).available).toBe(false)
    expect(schemeAvailability("fensa", COMPANY, { SCHEME_MODE: "live", SCHEME_SIM_COMPANIES: COMPANY }).available).toBe(false)
    expect(schemeFeatureEnabled(COMPANY, { SCHEME_MODE: "live" })).toBe(false)
  })

  test("a company not on the list has no feature, in any environment", () => {
    for (const VERCEL_ENV of ["production", "preview", "development", undefined]) {
      expect(schemeFeatureEnabled(COMPANY, { VERCEL_ENV })).toBe(false)
      expect(schemeFeatureEnabled(COMPANY, { VERCEL_ENV, SCHEME_SIM_COMPANIES: "someone-else" })).toBe(false)
      expect(schemeAvailability("fensa", COMPANY, { VERCEL_ENV }).available).toBe(false)
    }
    expect(schemeFeatureEnabled(null, env)).toBe(false)
    expect(schemeFeatureEnabled("", { SCHEME_SIM_COMPANIES: "" })).toBe(false)
  })

  test("a listed company gets the simulator on production", () => {
    expect(schemeAvailability("fensa", COMPANY, { VERCEL_ENV: "production", SCHEME_SIM_COMPANIES: COMPANY }).available).toBe(true)
  })

  test("sign-off for a company not on the list touches nothing", async () => {
    const job = testJob()
    const { store, registrations } = memoryStore(job)
    let reads = 0
    store.loadJob = async () => { reads++; return job }
    const outcome = await registerJob({ store, env: { ...env, SCHEME_SIM_COMPANIES: "" } }, { companyId: COMPANY, jobId: JOB, actorUserId: null })
    expect(outcome.status).toBe("not_required")
    expect(reads).toBe(0)
    expect(job.registration_status).toBe("pending")
    expect(registrations).toHaveLength(0)
  })

  test("the simulator takes only sim_ keys", async () => {
    const d = createSimulator()
    expect((await d.validateKey({ apiKey: "real-looking-key", memberNumber: "M1" })).ok).toBe(false)
    expect((await d.validateKey({ apiKey: "sim_abcd", memberNumber: "M1" })).ok).toBe(true)
  })
})

test.describe("the email and the key", () => {
  const email = {
    jobId: JOB, to: "homeowner@example.com", companyName: "Test <Glazing>", scheme: "fensa" as const,
    propertyAddress: "14 Test Road", certificateNumber: "ABC123", simulated: false,
  }

  test("says it is not the certificate, and escapes what it prints", () => {
    const m = buildHomeownerEmail(email)
    expect(m.text).toContain("is not the certificate")
    expect(m.html).toContain("Test &lt;Glazing&gt;")
  })

  test("a live send goes to the homeowner once, with an idempotency key", async () => {
    let seen: any
    const f = (async (_u: any, init: any) => { seen = init; return new Response(JSON.stringify({ id: "m1" }), { status: 200 }) }) as typeof fetch
    const r = await sendHomeownerConfirmation(email, env, f)
    expect(r.status).toBe("sent")
    expect(JSON.parse(seen.body).to).toEqual(["homeowner@example.com"])
    expect(seen.headers["Idempotency-Key"]).toBe(`scheme-homeowner-${JOB}`)
  })

  test("a simulated send goes only to the test address, and is marked", async () => {
    let seen: any
    const f = (async (_u: any, init: any) => { seen = init; return new Response("{}", { status: 200 }) }) as typeof fetch
    await sendHomeownerConfirmation({ ...email, simulated: true }, { ...env, SCHEME_TEST_EMAIL: "qa@example.com" }, f)
    const body = JSON.parse(seen.body)
    expect(body.to).toEqual(["qa@example.com"])
    expect(body.subject).toMatch(/^\[TEST\]/)
  })

  test("a live send with no address fails with the reason", async () => {
    const r = await sendHomeownerConfirmation({ ...email, to: null }, env)
    expect(r).toEqual({ status: "failed", reason: "there is no homeowner email on this job." })
  })

  test("a sealed key opens only for its own company and scheme", () => {
    const sealed = seal("secret", "scheme:a:fensa", env)
    expect(sealed).not.toContain("secret")
    expect(open(sealed, "scheme:a:fensa", env)).toBe("secret")
    expect(() => open(sealed, "scheme:b:fensa", env)).toThrow()
  })

  test("the deadline is 21 days from completion", () => {
    expect(registrationDeadline("2026-11-02")).toBe("2026-11-23")
    expect(registrationDeadline(null)).toBeNull()
  })
})
