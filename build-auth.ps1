# VANTRO — Auth callback + Supabase auth config
New-Item -Path "app\auth\callback" -ItemType Directory -Force | Out-Null

$callback = @'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/admin'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`)
}
'@
Set-Content -Path "app\auth\callback\route.ts" -Value $callback -Encoding UTF8

Write-Host "Auth callback created" -ForegroundColor Green
Write-Host "Now go to Supabase dashboard -> Authentication -> URL Configuration" -ForegroundColor Cyan
Write-Host "Set Site URL to: http://localhost:3000" -ForegroundColor Cyan
Write-Host "Add Redirect URL: http://localhost:3000/auth/callback" -ForegroundColor Cyan
