const fs = require("fs")
let c = fs.readFileSync("components/admin/AdminDashboard.tsx", "utf8")

// Find the tabs array and add defects
c = c.replace(
  '{ id: "alerts", label: `Alerts ${unreadAlerts}` }',
  '{ id: "alerts", label: `Alerts ${unreadAlerts}` },\n    { id: "defects", label: "Defects" }'
)

fs.writeFileSync("components/admin/AdminDashboard.tsx", c, "utf8")
console.log("Done - " + (c.includes('"defects"') ? "SUCCESS" : "FAILED"))
