const fs = require("fs")
let c = fs.readFileSync("app/installer/setup/page.tsx", "utf8")

// After PIN is saved successfully, sign out supabase session then redirect to installer
c = c.replace(
  "    setStep('done')\n    setLoading(false)\n    setTimeout(() => router.push('/installer'), 2000)",
  `    // Sign out supabase session - installer uses PIN auth not supabase session
    const supabase = createClient()
    await supabase.auth.signOut()
    setStep('done')
    setLoading(false)
    setTimeout(() => router.push('/installer'), 2000)`
)

fs.writeFileSync("app/installer/setup/page.tsx", c, "utf8")
console.log("Done")
