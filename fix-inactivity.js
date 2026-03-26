const fs = require("fs")
let c = fs.readFileSync("C:/vantro/app/installer/jobs/page.tsx", "utf8")

// Add inactivity timer state
c = c.replace(
  "  const [signInTime, setSignInTime] = useState<Date|null>(null)",
  `  const [signInTime, setSignInTime] = useState<Date|null>(null)
  const [lastActivity, setLastActivity] = useState<Date>(new Date())`
)

// Add inactivity effect after the auto-refresh effect
c = c.replace(
  "  async function signInToJob(job: any) {",
  `  useEffect(() => {
    if (!activeJob) return
    const events = ['click', 'touchstart', 'keydown', 'scroll']
    const resetActivity = () => setLastActivity(new Date())
    events.forEach(e => window.addEventListener(e, resetActivity))
    const check = setInterval(() => {
      const inactive = (Date.now() - lastActivity.getTime()) / 1000 / 60
      if (inactive >= 30) {
        const token = localStorage.getItem('vantro_installer_token')
        if (token && activeJob) {
          fetch('/api/signout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ jobId: activeJob.id, auto: true })
          })
        }
        setJobs(prev => prev.map((j: any) => ({ ...j, signed_in: false })))
        setActiveJob(null)
        setGpsStatus('idle')
        setSignInTime(null)
        setElapsed("")
        setView('jobs')
        alert('You have been automatically signed out due to 30 minutes of inactivity.')
      }
    }, 60000)
    return () => {
      events.forEach(e => window.removeEventListener(e, resetActivity))
      clearInterval(check)
    }
  }, [activeJob, lastActivity])

  async function signInToJob(job: any) {`
)

// Allow auto signout without GPS check
let signout = fs.readFileSync("C:/vantro/app/api/signout/route.ts", "utf8")
signout = signout.replace(
  "  const { jobId, lat, lng } = await request.json()",
  "  const { jobId, lat, lng, auto } = await request.json()"
)
signout = signout.replace(
  "  if (job?.lat && job?.lng && lat && lng) {",
  "  if (!auto && job?.lat && job?.lng && lat && lng) {"
)
fs.writeFileSync("C:/vantro/app/api/signout/route.ts", signout, "utf8")

fs.writeFileSync("C:/vantro/app/installer/jobs/page.tsx", c, "utf8")
console.log("Done")
