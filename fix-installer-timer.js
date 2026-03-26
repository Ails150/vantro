const fs = require("fs")
let c = fs.readFileSync("C:/vantro/app/installer/jobs/page.tsx", "utf8")

// Add timer state and signInTime
c = c.replace(
  "  const [qaNote, setQaNote] = useState<Record<string, string>>({})",
  `  const [qaNote, setQaNote] = useState<Record<string, string>>({})
  const [signInTime, setSignInTime] = useState<Date|null>(null)
  const [elapsed, setElapsed] = useState("")`
)

// Add timer effect and auto-refresh after loadJobs
c = c.replace(
  "  async function signInToJob(job: any) {",
  `  useEffect(() => {
    if (!signInTime) return
    const interval = setInterval(() => {
      const diff = Math.floor((Date.now() - signInTime.getTime()) / 1000)
      const h = Math.floor(diff / 3600)
      const m = Math.floor((diff % 3600) / 60)
      const s = diff % 60
      setElapsed((h > 0 ? h + "h " : "") + (m > 0 ? m + "m " : "") + s + "s")
    }, 1000)
    return () => clearInterval(interval)
  }, [signInTime])

  useEffect(() => {
    const token = localStorage.getItem('vantro_installer_token')
    if (!token) return
    const interval = setInterval(() => loadJobs(token), 30000)
    return () => clearInterval(interval)
  }, [])

  async function signInToJob(job: any) {`
)

// Set signInTime when confirmed
c = c.replace(
  "          setGpsStatus('confirmed')",
  "          setSignInTime(new Date())\n          setGpsStatus('confirmed')"
)

// Set signInTime when already signed in on load
c = c.replace(
  "    if (alreadySignedIn) { setActiveJob(alreadySignedIn); setGpsStatus('confirmed') }",
  "    if (alreadySignedIn) { setActiveJob(alreadySignedIn); setGpsStatus('confirmed'); setSignInTime(new Date()) }"
)

// Show timer in GPS banner
c = c.replace(
  "<span>{gpsStatus === 'checking' ? 'Checking your location...' : gpsMessage}</span>",
  "<span>{gpsStatus === 'checking' ? 'Checking your location...' : gpsMessage}{gpsStatus === 'confirmed' && elapsed ? ' · ' + elapsed : ''}</span>"
)

fs.writeFileSync("C:/vantro/app/installer/jobs/page.tsx", c, "utf8")
console.log("Done")
