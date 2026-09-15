import { test, expect } from "@playwright/test"
import { readResendMessageId } from "../../lib/weekly-report-send"

/**
 * The message id is the only handle anyone has on a report after it has left
 * the building. If it is wrong, "the customer says it never arrived" stays
 * unanswerable; if reading it can throw, a send that succeeded is reported as a
 * failure and somebody sends a second copy.
 */

test.describe("Resend message id: record it, never let it fail the send", () => {
  test("reads the id out of the normal response", () => {
    expect(readResendMessageId('{"id":"4ef9a417-02e9-4d39-ad75-9611e0fcc33c"}')).toBe(
      "4ef9a417-02e9-4d39-ad75-9611e0fcc33c",
    )
  })

  test("ignores the other fields Resend sends alongside it", () => {
    const body = '{"id":"abc-123","from":"noreply@getvantro.com","to":["a@b.com"]}'
    expect(readResendMessageId(body)).toBe("abc-123")
  })

  test("a body that is not JSON is null, not a throw", () => {
    // The send already happened by this point. Throwing here would turn an
    // accepted email into a reported failure.
    for (const body of ["", "Accepted", "<html>502</html>", "{oops"]) {
      expect(() => readResendMessageId(body)).not.toThrow()
      expect(readResendMessageId(body)).toBeNull()
    }
  })

  test("a missing, empty or non-string id is null", () => {
    expect(readResendMessageId("{}")).toBeNull()
    expect(readResendMessageId('{"id":""}')).toBeNull()
    expect(readResendMessageId('{"id":"   "}')).toBeNull()
    expect(readResendMessageId('{"id":12345}')).toBeNull()
    expect(readResendMessageId('{"id":null}')).toBeNull()
  })

  test("JSON that is not an object does not blow up", () => {
    for (const body of ["null", "[]", '"a string"', "42"]) {
      expect(readResendMessageId(body)).toBeNull()
    }
  })
})
