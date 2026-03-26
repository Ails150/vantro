const fs = require("fs")

// Fix signin route - change 500m to 150m
let signin = fs.readFileSync("app/api/signin/route.ts", "utf8")
signin = signin.replace("distanceMetres <= 500", "distanceMetres <= 150")
signin = signin.replace("must be within 500m", "must be within 150m")
fs.writeFileSync("app/api/signin/route.ts", signin, "utf8")

// Fix installer jobs page
let c = fs.readFileSync("app/installer/jobs/page.tsx", "utf8")

// Add signout from job function
c = c.replace(
  "  function signOut() {",
  `  async function signOutFromJob(job: any) {
    const token = localStorage.getItem('vantro_installer_token')
    await fetch('/api/signout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ jobId: job.id })
    })
    setJobs(prev => prev.map((j: any) => j.id === job.id ? { ...j, signed_in: false } : j))
    setActiveJob(null)
    setGpsStatus('idle')
    setView('jobs')
  }

  function signOut() {`
)

// Add sign out button in job card when signed in
c = c.replace(
  `                ) : activeJob?.id === job.id ? (
                  <div className="flex gap-2">
                    <button onClick={() => setView('diary')} className="flex-1 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-lg py-2 text-xs font-medium">Site diary</button>
                    <button onClick={() => setView('qa')} className="flex-1 bg-[#00d4a0]/10 text-[#00d4a0] border border-[#00d4a0]/20 rounded-lg py-2 text-xs font-medium">QA checklist</button>
                  </div>
                ) : null}`,
  `                ) : (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <button onClick={() => { setActiveJob(job); setView('diary') }} className="flex-1 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-lg py-2 text-xs font-medium">Site diary</button>
                      <button onClick={() => { setActiveJob(job); setView('qa'); loadQA(job) }} className="flex-1 bg-[#00d4a0]/10 text-[#00d4a0] border border-[#00d4a0]/20 rounded-lg py-2 text-xs font-medium">QA checklist</button>
                    </div>
                    <button onClick={() => signOutFromJob(job)} className="w-full bg-red-400/10 text-red-400 border border-red-400/20 rounded-lg py-2 text-xs font-medium">Sign out of job</button>
                  </div>
                )}`
)

fs.writeFileSync("app/installer/jobs/page.tsx", c, "utf8")
console.log("Done")
