const fs = require("fs")
let c = fs.readFileSync("C:/vantro/app/installer/jobs/page.tsx", "utf8")
c = c.replace(
  "        const data = await res.json()\n        if (res.ok) {",
  "        const data = await res.json()\n        if (!res.ok) {\n          setGpsStatus('blocked')\n          setGpsMessage(data.error || 'Cannot sign in')\n          setActiveJob(null)\n          return\n        }\n        if (res.ok) {"
)
fs.writeFileSync("C:/vantro/app/installer/jobs/page.tsx", c, "utf8")
console.log("Done - " + (c.includes("Cannot sign in") ? "SUCCESS" : "FAILED - pattern not found"))
