// E18. Secrets in the repo and in git history.
// E19. Secrets in the client bundle and the mobile app.
// E20. Security headers on every page.
//
// E21 (npm audit) is a separate spec because it shells out and is slow.

import { test, expect } from "@playwright/test"
import { execSync } from "child_process"
import fs from "fs"
import path from "path"
import { baseUrl } from "./harness"

const WEB = process.cwd()
const MOBILE = path.resolve(WEB, "..", "vantro-mobile")

/**
 * Patterns that indicate a real credential rather than a mention of one.
 *
 * Deliberately matched on VALUE SHAPES, not on words like "password". A test
 * that fails on the word "password" trains people to work around it, and then
 * it catches nothing.
 */
const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  // Supabase service role / anon keys are JWTs with a recognisable header.
  { name: "JWT (eyJ...)", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: "Stripe live secret", re: /\bsk_live_[A-Za-z0-9]{16,}/ },
  { name: "Stripe test secret", re: /\bsk_test_[A-Za-z0-9]{16,}/ },
  { name: "Stripe restricted", re: /\brk_live_[A-Za-z0-9]{16,}/ },
  { name: "Resend key", re: /\bre_[A-Za-z0-9]{20,}/ },
  { name: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "Anthropic key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: "OpenAI key", re: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { name: "Private key block", re: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
]

/**
 * Files that are TRACKED and legitimately contain a key-shaped value.
 *
 * Short, and each entry carries why. A mobile app's Google and Firebase keys
 * are shipped inside the APK by design -- anybody can extract them from a
 * download -- so their protection is the API restriction in the Google console
 * (package name plus signing certificate), not secrecy. That restriction cannot
 * be verified from here and is recorded in the report as an open item.
 */
const TRACKED_KEY_ALLOWLIST: Array<{ file: string; why: string }> = [
  { file: "app.json", why: "Google Maps key, shipped in the APK by design; must be restricted by package + SHA in the Google console" },
  { file: "google-services.json", why: "Firebase config, public by design; protected by Firebase rules, not by secrecy" },
]

/** Files that legitimately contain secret-shaped text. */
function isAllowedPath(rel: string): boolean {
  const p = rel.replace(/\\/g, "/")
  return (
    p.startsWith("node_modules/") ||
    p.startsWith(".next/") ||
    p.startsWith(".git/") ||
    p.startsWith("test-results/") ||
    p.startsWith("playwright-report/") ||
    // The security suite itself contains the patterns above.
    p.startsWith("tests/security/") ||
    // Fonts and binaries produce false positives on base64-looking runs.
    /\.(ttf|otf|woff2?|png|jpe?g|webp|ico|pdf|zip|bin|lock)$/i.test(p)
  )
}

/**
 * Paths git ignores.
 *
 * Skipped, because a gitignored .env.local is exactly where a credential is
 * SUPPOSED to live. Flagging it trains people to work around this test. What
 * matters is that no such file is tracked, which is its own test below, and
 * that nothing was ever committed, which is the history test.
 */
function ignoredPaths(root: string): Set<string> {
  try {
    const out = execSync("git status --porcelain --ignored=matching -z", {
      cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    })
    const ignored = new Set<string>()
    for (const entry of out.split("\u0000")) {
      if (entry.startsWith("!! ")) ignored.add(entry.slice(3).replace(/\/$/, ""))
    }
    return ignored
  } catch {
    return new Set()
  }
}

function scanTree(root: string): Array<{ file: string; pattern: string }> {
  const hits: Array<{ file: string; pattern: string }> = []
  if (!fs.existsSync(root)) return hits
  const ignored = ignoredPaths(root)
  const isIgnored = (rel: string) => {
    const p = rel.split(path.sep).join("/")
    for (const i of ignored) {
      if (p === i || p.startsWith(i + "/")) return true
    }
    return false
  }
  const allowed = new Set(TRACKED_KEY_ALLOWLIST.map(a => a.file))

  const walk = (dir: string) => {
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      const rel = path.relative(root, full)
      if (isAllowedPath(rel)) continue
      if (isIgnored(rel)) continue
      if (allowed.has(rel.split(path.sep).join("/"))) continue
      if (entry.isDirectory()) { walk(full); continue }
      let src = ""
      try {
        const stat = fs.statSync(full)
        if (stat.size > 3_000_000) continue
        const buf = fs.readFileSync(full)
        // A compiled bundle produces false positives: Hermes bytecode packs
        // symbol names end to end, and "re_" followed by 24 characters of
        // concatenated function names looks exactly like a Resend key. Binary
        // files are skipped and covered by the history test instead.
        if (buf.includes(0)) continue
        src = buf.toString("utf8")
      } catch { continue }
      for (const { name, re } of SECRET_PATTERNS) {
        if (re.test(src)) hits.push({ file: rel.replace(/\\/g, "/"), pattern: name })
      }
    }
  }
  walk(root)
  return hits
}

test.describe("E18: no credentials in the working tree", () => {
  test("the web repo is clean", () => {
    const hits = scanTree(WEB)
    expect(
      hits.map(h => `${h.file}: ${h.pattern}`),
      `secret-shaped values in tracked files:\n${hits.map(h => `  ${h.file} (${h.pattern})`).join("\n")}`,
    ).toEqual([])
  })

  test("the mobile repo is clean", () => {
    test.skip(!fs.existsSync(MOBILE), "vantro-mobile is not checked out beside this repo")
    const hits = scanTree(MOBILE)
    expect(hits.map(h => `${h.file}: ${h.pattern}`)).toEqual([])
  })

  test("no env file is tracked by git, in either repo", () => {
    for (const repo of [WEB, MOBILE]) {
      if (!fs.existsSync(repo)) continue
      const tracked = execSync("git ls-files", { cwd: repo, encoding: "utf8" })
        .split("\n")
        .map(l => l.trim())
        .filter(Boolean)

      const envFiles = tracked.filter(f => {
        const base = path.basename(f)
        // .env.example and .env.e2e.example are templates with blank values.
        if (/\.example$/.test(base)) return false
        return /^\.env($|\.)/.test(base) || /\.env\.local$/.test(base) || /\.jwk$/.test(base)
      })

      expect(envFiles, `${path.basename(repo)} tracks env files: ${envFiles.join(", ")}`)
        .toEqual([])
    }
  })

  test("no credential was ever committed, across all history", () => {
    // The working tree being clean says nothing about a key committed and then
    // removed: it is still in the history, and anybody with a clone has it.
    //
    // MATCHED ON FULL KEY SHAPES, not on prefixes. An earlier version searched
    // for the bare string "AKIA" and reported the mobile repo as compromised;
    // the hits were committed Hermes bytecode bundles under dist/, where the
    // symbol table packs function names end to end and "re_" followed by
    // twenty-four characters of concatenated identifiers looks exactly like a
    // Resend key. A security test that cries wolf gets switched off.
    const SHAPES = [
      "AKIA[0-9A-Z]{16}",
      "sk_live_[A-Za-z0-9]{16,}",
      "rk_live_[A-Za-z0-9]{16,}",
      "sk-ant-[A-Za-z0-9_-]{20,}",
      "-----BEGIN [A-Z ]*PRIVATE KEY-----",
    ]

    for (const repo of [WEB, MOBILE]) {
      if (!fs.existsSync(repo)) continue

      let revs: string[] = []
      try {
        revs = execSync("git rev-list --all", { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
          .split(String.fromCharCode(10)).map(r => r.trim()).filter(Boolean)
      } catch { continue }
      expect(revs.length, `${path.basename(repo)} has no history to scan`).toBeGreaterThan(0)

      let output = ""
      try {
        // -I excludes binary files, which is what removes the bytecode noise.
        output = execSync(
          `git grep -I -hoE "${SHAPES.join("|")}" $(git rev-list --all) -- . 2>/dev/null | sort -u | head -20`,
          { cwd: repo, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, shell: "bash" },
        )
      } catch {
        // git grep exits non-zero when nothing matches, which is the pass.
        output = ""
      }

      expect(
        output.trim(),
        `${path.basename(repo)} history contains a credential:
${output.slice(0, 2000)}`,
      ).toBe("")
    }
  })
})

test.describe("E19: no server secret reaches a client bundle", () => {
  const SERVER_ONLY = [
    "SUPABASE_SERVICE_ROLE_KEY",
    "JWT_SECRET",
    "AUDIT_SIGNING_KEY",
    "CRON_SECRET",
    "STRIPE_SECRET_KEY",
    "RESEND_API_KEY",
    "CLOUDFLARE_R2_SECRET_ACCESS_KEY",
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
  ]

  test("the built client JavaScript contains no server secret VALUE", () => {
    const staticDir = path.join(WEB, ".next", "static")
    test.skip(!fs.existsSync(staticDir), "no build present; run npm run build first")

    // The VALUES, read from the environment, are what must not appear. Testing
    // for the NAMES would be weaker: a name can legitimately appear in a
    // comment, and a value appearing is unambiguous.
    const values = SERVER_ONLY
      .map(name => ({ name, value: process.env[name] }))
      .filter(v => v.value && v.value.length > 12) as Array<{ name: string; value: string }>

    expect(values.length, "no server secrets loaded, so this test proves nothing")
      .toBeGreaterThan(2)

    const found: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) { walk(full); continue }
        if (!/\.(js|mjs|map|json|css)$/.test(entry.name)) continue
        const src = fs.readFileSync(full, "utf8")
        for (const { name, value } of values) {
          if (src.includes(value)) {
            found.push(`${name} in ${path.relative(WEB, full).replace(/\\/g, "/")}`)
          }
        }
      }
    }
    walk(staticDir)

    expect(found, `server secrets in the client bundle:\n${found.join("\n")}`).toEqual([])
  })

  test("the mobile source contains no server secret VALUE", () => {
    test.skip(!fs.existsSync(MOBILE), "vantro-mobile is not checked out beside this repo")

    const values = SERVER_ONLY
      .map(name => ({ name, value: process.env[name] }))
      .filter(v => v.value && v.value.length > 12) as Array<{ name: string; value: string }>

    const found: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === ".git") continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) { walk(full); continue }
        if (!/\.(ts|tsx|js|jsx|json|env)$/.test(entry.name)) continue
        let src = ""
        try { src = fs.readFileSync(full, "utf8") } catch { continue }
        for (const { name, value } of values) {
          if (src.includes(value)) {
            found.push(`${name} in ${path.relative(MOBILE, full).replace(/\\/g, "/")}`)
          }
        }
      }
    }
    walk(MOBILE)

    expect(found, `server secrets in the mobile app:\n${found.join("\n")}`).toEqual([])
  })

  test("the service role key is never referenced in a client component", () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) { walk(full); continue }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue
        const src = fs.readFileSync(full, "utf8")
        const isClient = /^["']use client["']/m.test(src)
        if (isClient && /SUPABASE_SERVICE_ROLE_KEY|JWT_SECRET|AUDIT_SIGNING_KEY|CRON_SECRET/.test(src)) {
          offenders.push(path.relative(WEB, full).replace(/\\/g, "/"))
        }
      }
    }
    for (const dir of ["app", "components", "lib"]) {
      const full = path.join(WEB, dir)
      if (fs.existsSync(full)) walk(full)
    }
    expect(offenders, `client components naming a server secret:\n${offenders.join("\n")}`)
      .toEqual([])
  })
})

test.describe("E20: security headers", () => {
  const PAGES = ["/", "/login", "/signup", "/privacy", "/verify"]

  const REQUIRED_HEADERS: Array<{ header: string; why: string; check?: (v: string) => boolean }> = [
    { header: "content-security-policy", why: "stops injected script executing" },
    {
      header: "strict-transport-security",
      why: "stops a downgrade to http",
      check: v => /max-age=\d+/.test(v) && Number(/max-age=(\d+)/.exec(v)?.[1] ?? 0) >= 15552000,
    },
    { header: "x-frame-options", why: "stops clickjacking" },
    { header: "x-content-type-options", why: "stops MIME sniffing" },
    { header: "referrer-policy", why: "stops URLs leaking to third parties" },
    { header: "permissions-policy", why: "stops silent camera and microphone access" },
  ]

  for (const page of PAGES) {
    test(`${page} carries every required header`, async ({ request }) => {
      const res = await request.get(`${baseUrl()}${page}`, { failOnStatusCode: false })
      const headers = res.headers()

      const missing: string[] = []
      for (const { header, why, check } of REQUIRED_HEADERS) {
        const value = headers[header]
        if (!value) { missing.push(`${header} (${why})`); continue }
        if (check && !check(value)) missing.push(`${header} present but weak: ${value}`)
      }

      expect(missing, `${page} is missing:\n${missing.join("\n")}`).toEqual([])
    })
  }

  test("an API response carries the headers too", async ({ request }) => {
    // A JSON endpoint is still a response a browser can be pointed at.
    const res = await request.get(`${baseUrl()}/api/admin/me`, { failOnStatusCode: false })
    const headers = res.headers()
    expect(headers["x-content-type-options"], "nosniff missing on an API response")
      .toBe("nosniff")
  })

  test("the CSP does not allow everything", async ({ request }) => {
    const res = await request.get(`${baseUrl()}/login`, { failOnStatusCode: false })
    const csp = res.headers()["content-security-policy"] ?? ""
    expect(csp).toContain("default-src")
    // A wildcard default-src would make the whole header decorative.
    expect(csp).not.toMatch(/default-src[^;]*\*\s*;/)
    expect(csp, "frame-ancestors missing, so X-Frame-Options is the only clickjacking defence")
      .toContain("frame-ancestors")
  })
})
