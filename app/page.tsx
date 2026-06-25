'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function Home() {
  const [signingIn, setSigningIn] = useState(false)

  useEffect(() => {
    const hash = window.location.hash
    if (!hash || !hash.includes('access_token')) return

    const params = new URLSearchParams(hash.replace(/^#/, ''))
    const access_token = params.get('access_token')
    const refresh_token = params.get('refresh_token')
    if (!access_token || !refresh_token) return

    setSigningIn(true)
    const supabase = createClient()
    supabase.auth
      .setSession({ access_token, refresh_token })
      .then(({ error }) => {
        // Strip the tokens from the URL so they aren't left in history.
        history.replaceState(null, '', window.location.pathname + window.location.search)
        if (error) {
          window.location.href = '/login?error=auth'
          return
        }
        // Session cookie is now set; let the server route by role
        // (admins -> /admin, installers -> /installer).
        window.location.href = '/auth/route-after-login'
      })
  }, [])

  if (!signingIn) return null

  return (
    <div className="min-h-screen bg-[#0f1923] flex items-center justify-center px-4">
      <div className="text-center">
        <div className="inline-flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg bg-[#00d4a0] flex items-center justify-center">
            <span className="text-[#0f1923] font-bold">V</span>
          </div>
          <span className="text-white text-xl font-semibold">Van<span className="text-[#00d4a0]">tro</span></span>
        </div>
        <p className="text-[#8fa3b8] text-sm">Signing you in...</p>
      </div>
    </div>
  )
}
