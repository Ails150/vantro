import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'fallback-change-me'

interface InstallerPayload {
  userId: string
  companyId: string
  subcontractorId: string | null
  exp: number
}

export function createInstallerToken(
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

export function verifyInstallerToken(request: Request): InstallerPayload | null {
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
    try {
      const payload = JSON.parse(Buffer.from(auth.slice(7), 'base64').toString())
      if (payload.exp < Date.now()) return null
      return { ...payload, subcontractorId: payload.subcontractorId ?? null }
    } catch { return null }
  }
}
