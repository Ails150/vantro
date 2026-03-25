# VANTRO Foundation Files Setup Script
# Run from C:\vantro in PowerShell

$client = @'
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
'@
Set-Content -Path "lib\supabase\client.ts" -Value $client -Encoding UTF8

$server = @'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    }
  )
}

export async function createServiceClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    }
  )
}
'@
Set-Content -Path "lib\supabase\server.ts" -Value $server -Encoding UTF8

$middleware = @'
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  if (request.nextUrl.pathname.startsWith('/admin') && !user) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (request.nextUrl.pathname === '/login' && user) {
    const url = request.nextUrl.clone()
    url.pathname = '/admin'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
'@
Set-Content -Path "middleware.ts" -Value $middleware -Encoding UTF8

$types = @'
export type Role = 'installer' | 'foreman' | 'admin'
export type JobStatus = 'pending' | 'active' | 'completed' | 'cancelled'
export type QAState = 'pending' | 'submitted' | 'approved' | 'rejected'
export type AlertType = 'blocker' | 'issue' | 'info'
export type ItemType = 'tick' | 'photo' | 'measurement' | 'pass_fail'

export interface Company {
  id: string
  name: string
  slug: string
  plan: string
  trial_ends_at: string
  created_at: string
}

export interface User {
  id: string
  company_id: string
  email?: string
  name: string
  initials: string
  role: Role
  is_active: boolean
  created_at: string
}

export interface Job {
  id: string
  company_id: string
  name: string
  address: string
  lat?: number
  lng?: number
  template_id?: string
  status: JobStatus
  contract_value?: number
  created_at: string
  completed_at?: string
}

export interface SignIn {
  id: string
  job_id: string
  user_id: string
  company_id: string
  lat: number
  lng: number
  accuracy_metres?: number
  distance_from_site_metres?: number
  within_range: boolean
  signed_in_at: string
  signed_out_at?: string
}

export interface DiaryEntry {
  id: string
  job_id: string
  user_id: string
  company_id: string
  entry_text: string
  photo_urls?: string[]
  ai_processed: boolean
  created_at: string
}

export interface Alert {
  id: string
  company_id: string
  job_id: string
  diary_entry_id?: string
  triggered_by: string
  alert_type: AlertType
  message: string
  is_read: boolean
  created_at: string
}

export interface QASubmission {
  id: string
  job_id: string
  user_id: string
  company_id: string
  checklist_item_id: string
  state: QAState
  value?: string
  photo_url?: string
  notes?: string
  submitted_at?: string
  reviewed_by?: string
  reviewed_at?: string
  rejection_note?: string
}

export interface PayrollApproval {
  id: string
  company_id: string
  week_start: string
  approved_by: string
  approved_at: string
  notes?: string
}
'@
Set-Content -Path "lib\types.ts" -Value $types -Encoding UTF8

Write-Host "All files created successfully" -ForegroundColor Green
