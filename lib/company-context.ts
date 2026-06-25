import { cookies } from "next/headers"
import { createClient, createServiceClient } from "@/lib/supabase/server"

// Cookie that holds the company a platform "support" user is currently viewing.
export const SUPPORT_COMPANY_COOKIE = "vantro_support_company"

// users.company_id is NOT NULL, but a platform support user belongs to no real
// company (their effective company comes from the switcher cookie). We park
// their row on this sentinel company id to satisfy the constraint; support code
// paths ignore the row's own company_id.
export const PLATFORM_SENTINEL_COMPANY_ID = "00000000-0000-0000-0000-000000000001"

export type CallerContext = {
  authUserId: string
  userId: string
  role: string
  name: string | null
  email: string | null
  isSupport: boolean
  // The company this request should operate on. For normal users this is their
  // own company; for a support user it's the company they've switched into
  // (null if they haven't picked one yet).
  companyId: string | null
  // The user's own company_id (null for platform support users).
  baseCompanyId: string | null
}

// Resolves the effective company context for the logged-in user from the
// session cookie. Works in both server components and route handlers.
//
// This is the single place cross-company "support" access is granted: a
// support user's effective company comes from the SUPPORT_COMPANY_COOKIE
// rather than their own users row.
export async function getCallerContext(): Promise<CallerContext | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const service = await createServiceClient()
  // Use limit(1), not .single(): if a data glitch ever leaves two users rows
  // sharing one auth_user_id, .single() throws (PGRST116) and the caller gets
  // null — silently bouncing the user back to /login. Picking the oldest match
  // degrades gracefully instead of locking them out.
  const { data: rows } = await service
    .from("users")
    .select("id, company_id, role, name, email")
    .eq("auth_user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
  const u = rows?.[0]
  if (!u) return null

  const isSupport = u.role === "support"
  let companyId: string | null = u.company_id

  if (isSupport) {
    const jar = await cookies()
    companyId = jar.get(SUPPORT_COMPANY_COOKIE)?.value || null
  }

  return {
    authUserId: user.id,
    userId: u.id,
    role: u.role,
    name: u.name,
    email: u.email,
    isSupport,
    companyId,
    baseCompanyId: u.company_id,
  }
}
