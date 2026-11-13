// isCompanyKey: a client-supplied storage path is accepted only if it is a key
// uploadKey() could have issued to this company.

import { test, expect } from "@playwright/test"
import { isCompanyKey, uploadKey } from "../../lib/upload-key"

const A = "00000000-0000-0000-0000-00000000000a"
const B = "00000000-0000-0000-0000-00000000000b"

test("a key uploadKey issued to the company passes", () => {
  for (const type of ["image/jpeg", "video/mp4", "application/pdf", "image/x-unknown"]) {
    const key = uploadKey(A, type, "qa/whatever")
    expect(isCompanyKey(key, A), key).toBe(true)
  }
})

test("another company's key fails", () => {
  expect(isCompanyKey(uploadKey(B, "image/jpeg", "qa"), A)).toBe(false)
})

test("legacy, reserved and malformed paths fail", () => {
  const uuid = "12345678-1234-1234-1234-123456789abc"
  const bad = [
    `qa/${uuid}/item/photo_1.jpg`,
    `audit-archive/${A}/pack.zip`,
    `u/${A}/202611/qa/../../u/${B}/202611/qa/${uuid}.jpg`,
    `u/${A}/202611/../${uuid}.jpg`,
    `u/${A}/202611/qa/sub/${uuid}.jpg`,
    `u/${A}/2026/qa/${uuid}.jpg`,
    `u/${A}/202611/QA/${uuid}.jpg`,
    `u/${A}/202611/qa/not-a-uuid.jpg`,
    `/u/${A}/202611/qa/${uuid}.jpg`,
    `u/${A.toUpperCase()}/202611/qa/${uuid}.jpg`,
    "",
  ]
  for (const p of bad) expect(isCompanyKey(p, A), p).toBe(false)
  expect(isCompanyKey(`u/${A}/202611/qa/${uuid}.jpg`, A)).toBe(true)
})

test("non-strings and a missing company fail", () => {
  const key = uploadKey(A, "image/jpeg")
  expect(isCompanyKey(key, null)).toBe(false)
  expect(isCompanyKey(key, undefined)).toBe(false)
  expect(isCompanyKey(key, "")).toBe(false)
  for (const v of [null, undefined, 1, {}, [key]]) expect(isCompanyKey(v as any, A)).toBe(false)
})
