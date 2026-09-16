// lib/sql-escape.ts
//
// Escape user input before it becomes a LIKE pattern.
//
// THIS IS NOT SQL INJECTION, AND THAT IS WHY IT SURVIVED. PostgREST parameterises
// everything; no quote ever escapes. What it does not do is stop a VALUE from
// being interpreted as a PATTERN. `.ilike("email", input)` sends the input as a
// LIKE pattern, and in a LIKE pattern `%` means "anything" and `_` means "any
// one character".
//
// So a sign-in request carrying the email `%@holts.co.uk` did not fail to match
// a user. It matched whichever user the pattern happened to single out, and the
// route issued that person a ninety-day field token. Proven against production:
// a PIN sign-in with `security-b7-probe-%@vantro.test` came back 200 with a
// working token for an account whose address the caller never knew.
//
// Every place that puts request input into ilike() has to go through this. The
// escape character is backslash, which is PostgreSQL's LIKE default, and the
// backslash itself has to be escaped first or escaping the wildcards would
// double-escape anything already containing one.

/**
 * Make a user-supplied string match only itself.
 *
 * Use with `.ilike(column, escapeLikePattern(value))` when the intent is
 * case-insensitive EQUALITY, which is what every caller in this codebase
 * means. If you actually want a prefix search, append the `%` yourself AFTER
 * escaping -- that way the wildcard is one you wrote rather than one the user
 * sent.
 */
export function escapeLikePattern(value: string): string {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
}

/**
 * True when a string would behave as a pattern rather than as a literal.
 *
 * Used to refuse outright, rather than only to escape, on the paths where the
 * value is an email address. No real address contains an unescaped `%`, so a
 * request carrying one is not a typo -- it is somebody probing, and it is worth
 * refusing loudly rather than quietly matching nothing.
 */
export function looksLikePattern(value: string): boolean {
  return /[%_\\]/.test(String(value ?? ""))
}
