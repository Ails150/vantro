import { test, expect } from "@playwright/test"
import fs from "fs"
import path from "path"
import { serviceClient } from "./harness"
import { INSTALLER_IP_CEILING, bearerToken, tokenBucketId } from "../../lib/installer-rate-limit"
import { LIMITS, rateLimit, redactKey } from "../../lib/rate-limit"

/**
 * F23 -- rate limits actually refuse, with a 429.
 *
 * This drives the real limiter against the real database rather than reading
 * source for the string "checkRateLimit". A limiter that is imported, called,
 * and always returns true because its SQL function is missing or its table has
 * no rows would pass every static check and stop nothing.
 *
 * It is slow -- it makes dozens of round trips on purpose -- and it is meant to
 * be. Each test cleans up the keys it invented so the suite can run repeatedly.
 */

test.describe.configure({ mode: "serial" })

/** A key nothing else will collide with, in a bucket nothing real uses. */
function probeKey(label: string): string {
  return `sectest:${label}:${Math.random().toString(36).slice(2)}`
}

async function clear(prefix: string) {
  const service = serviceClient()
  await service.from("rate_limit_hits").delete().like("key", `${prefix}%`)
}

test.afterAll(async () => {
  await clear("sectest:")
})

test("the limiter refuses once the limit is reached", async () => {
  const key = probeKey("basic")
  const allowed: boolean[] = []
  for (let i = 0; i < 5; i++) {
    allowed.push((await rateLimit(key, 3, 60)).allowed)
  }
  // Three through, then refusals. Not "roughly three".
  expect(allowed).toEqual([true, true, true, false, false])
})

test("it is atomic under concurrency, which is the case that matters", async () => {
  // THE BUG THIS EXISTS FOR, TWICE.
  //
  // First the limiter counted and then inserted as two round trips from the
  // application, so simultaneous requests all read the same count and all
  // proceeded. Moving both into one plpgsql function did NOT fix it: a function
  // body is not a critical section, and at READ COMMITTED the SELECT takes a
  // snapshot and locks nothing. This test passed twice and then let four
  // through at a limit of three, which is the whole reason it is written as
  // several rounds rather than one -- a concurrency test that passes once is
  // not evidence of anything.
  //
  // The fix is pg_advisory_xact_lock on the key. See
  // 20260916170000_rate_limit_serialise.sql.
  for (let round = 0; round < 3; round++) {
    const key = probeKey(`concurrent-${round}`)
    const results = await Promise.all(
      Array.from({ length: 30 }, () => rateLimit(key, 3, 60)),
    )
    const permitted = results.filter(r => r.allowed).length
    const degraded = results.filter(r => r.degraded).length
    // A degraded result is a fail-open, and under load it counts as allowed.
    // Reported separately so a failure says which of the two things broke.
    expect(degraded, `round ${round}: ${degraded} checks failed open under load`).toBe(0)
    expect(
      permitted,
      `round ${round}: ${permitted} of 30 concurrent requests got through a limit of 3`,
    ).toBe(3)
  }
})

test("a refusal says how long to wait", async () => {
  const key = probeKey("retry")
  await rateLimit(key, 1, 120)
  const blocked = await rateLimit(key, 1, 120)
  expect(blocked.allowed).toBe(false)
  // Without this a client that is looping has no idea how long to back off,
  // and the usual behaviour is to retry immediately and stay blocked.
  expect(blocked.retryAfter).toBeGreaterThan(0)
  expect(blocked.retryAfter).toBeLessThanOrEqual(120)
})

test("the window actually expires", async () => {
  const key = probeKey("window")
  // A one-second window: one hit, refused, then allowed again once it ages out.
  expect((await rateLimit(key, 1, 1)).allowed).toBe(true)
  expect((await rateLimit(key, 1, 1)).allowed).toBe(false)
  await new Promise(r => setTimeout(r, 1300))
  expect(
    (await rateLimit(key, 1, 1)).allowed,
    "the window never frees up, so a blocked caller is blocked for ever",
  ).toBe(true)
})

test("separate keys do not share a bucket", async () => {
  const a = probeKey("iso-a")
  const b = probeKey("iso-b")
  await rateLimit(a, 1, 60)
  expect((await rateLimit(a, 1, 60)).allowed).toBe(false)
  expect(
    (await rateLimit(b, 1, 60)).allowed,
    "one blocked caller has blocked everyone",
  ).toBe(true)
})

test("an empty key is refused rather than bucketing the world together", async () => {
  // A null or empty key would put every caller in one bucket, and the first
  // time anything hit its limit the whole product would be down. The SQL
  // function raises; the wrapper fails open and reports, which is the right
  // pair of behaviours -- but it must not silently count.
  const result = await rateLimit("", 5, 60)
  expect(result.degraded).toBe(true)
  expect(result.allowed).toBe(true)
})

test.describe("the field-app buckets", () => {
  test("a token gets a bucket that cannot be reverse engineered from the key", async () => {
    const token = "eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJhIn0.sig"
    const id = await tokenBucketId(token)
    expect(id).toMatch(/^[0-9a-f]{16}$/)
    // Keys reach logs and Sentry. A key containing a live ninety-day credential
    // would leak it to exactly the place the mobile scrubbing work kept it out
    // of.
    expect(id).not.toContain(token.slice(0, 12))
  })

  test("different tokens get different buckets", async () => {
    const a = await tokenBucketId("token-a")
    const b = await tokenBucketId("token-b")
    expect(a).not.toBe(b)
  })

  test("the same token always gets the same bucket", async () => {
    // Otherwise the limit resets every request and counts nothing.
    expect(await tokenBucketId("stable")).toBe(await tokenBucketId("stable"))
  })

  test("the header parser accepts what the app actually sends", () => {
    expect(bearerToken(new Headers({ Authorization: "Bearer abc.def.ghi" }))).toBe("abc.def.ghi")
    expect(bearerToken(new Headers({ authorization: "bearer abc" }))).toBe("abc")
    expect(bearerToken(new Headers({}))).toBeNull()
    expect(bearerToken(new Headers({ Authorization: "Basic abc" }))).toBeNull()
  })

  test("the ceiling is above what a busy site legitimately produces", () => {
    // Twenty workers behind one router at a full minute of the per-token limit
    // must not trip the shared ceiling, or a busy site is blocked for being
    // busy. This is the calculation that sets the number, written down so a
    // future change to either has to face it.
    const busySite = 20 * 5 // twenty phones, five requests a minute each
    expect(INSTALLER_IP_CEILING.max).toBeGreaterThan(busySite)
    expect(LIMITS.installerToken.max).toBeLessThan(INSTALLER_IP_CEILING.max)
    // And the anonymous bucket is much tighter than the token one, because
    // nothing legitimate calls the field API in volume without a credential.
    expect(LIMITS.installerAnon.max).toBeLessThan(LIMITS.installerToken.max)
  })
})

test.describe("what reaches the logs", () => {
  test("an email in a key is reduced to its domain", () => {
    // The key goes to Sentry on every block. The address of somebody being
    // brute forced is personal data we did not need to send.
    expect(redactKey("reset-pin:email:marcus@holts.co.uk")).toBe("reset-pin:email:***@holts.co.uk")
  })

  test("a token bucket id is truncated", () => {
    expect(redactKey("installer:token:0123456789abcdef")).toBe("installer:token:01234567…")
  })

  test("an IP is kept, because it is the thing being blocked", () => {
    expect(redactKey("installer:ip:1.2.3.4")).toBe("installer:ip:1.2.3.4")
  })
})

test.describe("the middleware returns a real 429", () => {
  // Driven through the actual middleware export rather than by flooding a
  // deployed server, because the only way to prove a limiter over HTTP is to
  // send enough traffic to trip it -- which against production is a denial of
  // service on paying customers, and against a dev server proves only that a
  // dev server was running. This calls the code that runs on every request.

  async function callMiddleware(path: string, headers: Record<string, string>) {
    const { installerGate } = await import("../../lib/installer-rate-limit")
    const req = new Request(`https://app.getvantro.com${path}`, { headers })
    return await installerGate(req)
  }

  test("middleware really calls the gate, for the whole prefix", () => {
    // installerGate is driven directly below. This is the one assertion that
    // ties it to the request path: without it, every test in this block could
    // pass while middleware.ts had stopped calling it.
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "middleware.ts"), "utf8")
    expect(src).toContain("installerGate")
    expect(src).toMatch(/startsWith\(['"]\/api\/installer['"]\)/)
    // And before updateSession, so a refused request does not first cost a
    // round trip to the auth server.
    expect(src.indexOf("installerGate")).toBeLessThan(src.indexOf("updateSession(request)"))
  })

  test("an installer request over the limit gets 429 with Retry-After", async () => {
    // A unique token, so this is this test's own bucket. Sixty-one requests at
    // a limit of sixty: the last one must be refused.
    const token = `sectest-${Math.random().toString(36).slice(2)}.${Date.now()}.sig`
    const headers = {
      authorization: `Bearer ${token}`,
      "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 200) + 1}`,
    }

    let last: Response | undefined
    for (let i = 0; i <= LIMITS.installerToken.max; i++) {
      last = (await callMiddleware("/api/installer/jobs", headers))!
      if (last?.status === 429) break
    }

    expect(last?.status, "the field app is not rate limited at all").toBe(429)
    const retryAfter = Number(last!.headers.get("Retry-After"))
    expect(retryAfter).toBeGreaterThan(0)
    expect(last!.headers.get("RateLimit-Limit")).toBe(String(LIMITS.installerToken.max))
    const body = await last!.json()
    expect(body.error).toMatch(/too many/i)
    // It must not leak which bucket tripped or what the key was.
    expect(JSON.stringify(body)).not.toContain(token)

    await clear(`installer:token:${await tokenBucketId(token)}`)
    await clear(`installer:ip:${headers["x-forwarded-for"]}`)
  })

  test("a request under the limit is not refused", async () => {
    // Without this the test above passes on middleware that 429s everything,
    // which would be an outage rather than a limiter.
    const headers = {
      authorization: `Bearer sectest-fresh-${Math.random().toString(36).slice(2)}`,
      "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 200) + 1}`,
    }
    // null means "carry on" -- the gate returns a Response only to refuse.
    const res = await callMiddleware("/api/installer/jobs", headers)
    expect(res, "a fresh token was refused on its first request").toBeNull()
  })

  test("the limit covers a route nobody remembered to guard", async () => {
    // The whole reason it is in middleware. This path does not exist; it is
    // standing in for the nineteenth installer route somebody adds next month.
    const token = `sectest-unguarded-${Math.random().toString(36).slice(2)}`
    const headers = {
      authorization: `Bearer ${token}`,
      "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 200) + 1}`,
    }
    let last: Response | undefined
    for (let i = 0; i <= LIMITS.installerToken.max; i++) {
      last = (await callMiddleware("/api/installer/some-route-added-later", headers))!
      if (last?.status === 429) break
    }
    expect(last?.status).toBe(429)
    await clear(`installer:token:${await tokenBucketId(token)}`)
    await clear(`installer:ip:${headers["x-forwarded-for"]}`)
  })

  test("an unauthenticated field request is limited far sooner", async () => {
    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`
    let last: Response | undefined
    for (let i = 0; i <= LIMITS.installerAnon.max; i++) {
      last = (await callMiddleware("/api/installer/jobs", { "x-forwarded-for": ip }))!
      if (last?.status === 429) break
    }
    expect(last?.status).toBe(429)
    await clear(`installer:anon:${ip}`)
    await clear(`installer:ip:${ip}`)
  })
})

test.describe("the SQL function is really there", () => {
  test("check_rate_limit exists and returns the three columns", async () => {
    // If the migration had not been applied, every test above would still pass:
    // the wrapper fails open, so a missing function looks exactly like an
    // unlimited allowance. This is the test that tells them apart.
    const service = serviceClient()
    const key = probeKey("rpc")
    const { data, error } = await service.rpc("check_rate_limit", {
      p_key: key, p_max_hits: 1, p_window_seconds: 60,
    })
    expect(error, error?.message).toBeNull()
    const row = Array.isArray(data) ? data[0] : data
    expect(row).toMatchObject({ allowed: true })
    expect(row).toHaveProperty("hits")
    expect(row).toHaveProperty("retry_after_seconds")
  })

  test("the prune function exists", async () => {
    const service = serviceClient()
    const { error } = await service.rpc("prune_rate_limit_hits")
    expect(error, error?.message).toBeNull()
  })

  test("no client session can read the hit table", async () => {
    // It is a record of who has been trying what, it is not tenant-scoped, and
    // an attacker who can read it can see exactly how close they are.
    const { anonClient } = await import("./harness")
    const { data, error } = await anonClient().from("rate_limit_hits").select("key").limit(1)
    expect(error || (data && data.length === 0), "anon could read rate_limit_hits").toBeTruthy()
  })
})
