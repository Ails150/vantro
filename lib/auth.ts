import jwt from 'jsonwebtoken'

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

export function createFieldToken(
  userId: string,
  companyId: string,
  subcontractorId: string | null = null
): string {
  return jwt.sign(
    { userId, companyId, subcontractorId },
    JWT_SECRET,
    { expiresIn: '10h' }
  )
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
