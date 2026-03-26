const fs = require("fs")
let c = fs.readFileSync("C:/vantro/app/installer/jobs/page.tsx", "utf8")
c = c.replace(
  "          setGpsStatus('blocked')\n          setGpsMessage(data.error || 'Cannot sign in')\n          setActiveJob(null)\n          return",
  "          setGpsStatus('blocked')\n          setGpsMessage(data.error || 'Cannot sign in')\n          return"
)
fs.writeFileSync("C:/vantro/app/installer/jobs/page.tsx", c, "utf8")
console.log("Done - " + (c.includes("setActiveJob(null)") ? "STILL HAS NULL" : "FIXED"))
