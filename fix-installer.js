const fs = require("fs")
let c = fs.readFileSync("app/installer/jobs/page.tsx", "utf8")

// Show tabs if job is already signed in, not just when GPS is confirmed
c = c.replace(
  '{activeJob && gpsStatus === \'confirmed\' && (',
  '{activeJob && (gpsStatus === \'confirmed\' || activeJob.signed_in) && ('
)

// Auto-set activeJob if already signed in on load
c = c.replace(
  '    setJobs(data.jobs || [])\n    setLoading(false)',
  `    const jobs = data.jobs || []
    setJobs(jobs)
    const alreadySignedIn = jobs.find((j: any) => j.signed_in)
    if (alreadySignedIn) { setActiveJob(alreadySignedIn); setGpsStatus('confirmed') }
    setLoading(false)`
)

fs.writeFileSync("app/installer/jobs/page.tsx", c, "utf8")
console.log("Done")
