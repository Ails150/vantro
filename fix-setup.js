const fs = require("fs")
let c = fs.readFileSync("app/installer/setup/page.tsx", "utf8")

// Add session extraction from hash on mount
c = c.replace(
  "  const [step, setStep] = useState<'password'|'pin'|'done'>('password')",
  `  const [step, setStep] = useState<'password'|'pin'|'done'>('password')
  const [sessionReady, setSessionReady] = useState(false)
  const [sessionError, setSessionError] = useState('')`
)

c = c.replace(
  "  async function setPasswordStep",
  `  useEffect(() => {
    async function extractSession() {
      const hash = window.location.hash
      if (hash && hash.includes('access_token')) {
        const params = new URLSearchParams(hash.replace('#', ''))
        const access_token = params.get('access_token')
        const refresh_token = params.get('refresh_token')
        if (access_token && refresh_token) {
          const supabase = createClient()
          const { error } = await supabase.auth.setSession({ access_token, refresh_token })
          if (error) { setSessionError('Session error: ' + error.message); return }
          setSessionReady(true)
          return
        }
      }
      // Check if already has session
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (session) { setSessionReady(true) }
      else { setSessionError('No session found. Please use the link from your invite email.') }
    }
    extractSession()
  }, [])

  async function setPasswordStep`
)

// Add sessionError display and loading state
c = c.replace(
  "    <h1 className=\"text-lg font-semibold mb-1\">Set your password</h1>",
  `    {sessionError && <p className="text-sm text-red-400 mb-4">{sessionError}</p>}
    {!sessionReady && !sessionError && <p className="text-sm text-[#4d6478] mb-4">Loading session...</p>}
    <h1 className="text-lg font-semibold mb-1">Set your password</h1>`
)

// Add useEffect to imports
c = c.replace(
  "import { useState, Suspense } from 'react'",
  "import { useState, useEffect, Suspense } from 'react'"
)

fs.writeFileSync("app/installer/setup/page.tsx", c, "utf8")
console.log("Done")
