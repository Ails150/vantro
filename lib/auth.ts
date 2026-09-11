import jwt, { type SignOptions } from 'jsonwebtoken'

// Every token in the system is signed with this. There is deliberately no
// fallback: a literal default is public in the repo and would let anyone forge
// a field or client token for any company, and falling back to the
// service role key would make one leak compromise both. Missing config must
// stop the process, not quietly downgrade it.
if (!process.env.JWT_SECRET) {
  throw new Error(
    'JWT_SECRET is not set. Set it in the environment before starting. ' +
    'It must not fall back to a literal or to SUPABASE_SERVICE_ROLE_KEY.'
  )
}
export const JWT_SECRET: string = process.env.JWT_SECRET

interface FieldPayload {
  userId: string
  companyId: string
  subcontractorId: string | null
  exp: number
}

/**
 * How long a field token lasts.
 *
 * 'shift' is the original 10 hours: long enough to cover a day on site, short
 * enough that a lost phone stops working by the next morning. It is what PIN
 * login issues, because a PIN can be re-entered.
 *
 * 'persistent' is for a worker who joined from an invite link. They have no
 * password and no PIN to fall back on -- sending them to find the original
 * WhatsApp message every morning is how a free trial dies in week one -- so
 * the token lasts a season. The trade is deliberate and narrow: it is only
 * issued by the join flow, and only to a field role.
 */
export type FieldTokenLife = 'shift' | 'persistent'

type Expiry = SignOptions['expiresIn']

const FIELD_TOKEN_EXPIRY: Record<FieldTokenLife, Expiry> = {
  shift: '10h',
  persistent: '90d',
}

export function createFieldToken(
  userId: string,
  companyId: string,
  subcontractorId: string | null = null,
  life: FieldTokenLife = 'shift'
): string {
  return jwt.sign(
    { userId, companyId, subcontractorId },
    JWT_SECRET,
    { expiresIn: FIELD_TOKEN_EXPIRY[life] }
  )
}

/**
 * A company's shareable worker invite.
 *
 * Signed rather than stored, so there is no table and no row to clean up: the
 * company id IS the payload, and the signature is what makes it unforgeable.
 * The cost of that choice is that it cannot be revoked individually -- so it
 * expires on its own, and it can only ever do one thing, which is add a field
 * worker to one named company.
 */
export interface InvitePayload {
  companyId: string
  exp: number
}

export function createInviteToken(companyId: string, expiresIn: Expiry = '30d'): string {
  return jwt.sign({ companyId, kind: 'worker-invite' }, JWT_SECRET, { expiresIn })
}

export function verifyInviteToken(token: string): { companyId: string } | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any
    // The kind check matters: without it any field token, which also carries a
    // companyId, would be accepted here as an invite.
    if (decoded.kind !== 'worker-invite' || !decoded.companyId) return null
    return { companyId: decoded.companyId }
  } catch {
    return null
  }
}

export function verifyFieldToken(request: Request): FieldPayload | null {
  const auth = request.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return null
  try {
    const decoded = jwt.verify(auth.slice(7), JWT_SECRET) as any
    if (!decoded.userId || !decoded.companyId) return null
    return {
      userId: decoded.userId,
      companyId: decoded.companyId,
      subcontractorId: decoded.subcontractorId ?? null,
      exp: decoded.exp
    }
  } catch {
    // No fallback, deliberately. This used to base64-decode the token body
    // and trust it, to carry over the unsigned pre-JWT tokens minted before
    // 600b293 (2026-04-14). Those carried an 8h expiry, so the last valid one
    // died on 2026-04-15; after that this branch only ever admitted forgeries,
    // since an attacker authors the JSON themselves and picks any userId and
    // companyId. A token we cannot verify is not a token. Reject it.
    return null
  }
}
