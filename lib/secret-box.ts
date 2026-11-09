// lib/secret-box.ts
//
// Seals a customer's third party credential before it reaches the database.
// AES-256-GCM, with the owner of the secret as additional data, so a sealed
// value copied onto another company's row will not open.
//
// SCHEME_KEY_ENCRYPTION_KEY is 32 random bytes, base64:
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

import crypto from "crypto"

type Env = Record<string, string | undefined>

function masterKey(env: Env): Buffer {
  const raw = env.SCHEME_KEY_ENCRYPTION_KEY
  if (!raw) throw new Error("SCHEME_KEY_ENCRYPTION_KEY is not set")
  const key = Buffer.from(raw, "base64")
  if (key.length !== 32) throw new Error("SCHEME_KEY_ENCRYPTION_KEY must be 32 bytes, base64")
  return key
}

export function seal(plaintext: string, context: string, env: Env = process.env): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey(env), iv)
  cipher.setAAD(Buffer.from(context, "utf8"))
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(":")
}

/** Throws if the value was altered, or belongs to a different context. */
export function open(sealed: string, context: string, env: Env = process.env): string {
  const [version, iv, tag, body] = sealed.split(":")
  if (version !== "v1" || !iv || !tag || body === undefined) throw new Error("Unrecognised sealed value")
  const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey(env), Buffer.from(iv, "base64"))
  decipher.setAAD(Buffer.from(context, "utf8"))
  decipher.setAuthTag(Buffer.from(tag, "base64"))
  return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8")
}
