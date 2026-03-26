const fs = require("fs")
let c = fs.readFileSync("components/admin/AdminDashboard.tsx", "utf8")
// Remove everything between PayrollTab and the alerts tab
c = c.replace(
  /(<PayrollTab teamMembers=\{teamMembers\} \/>[\s\S]*?)(\{activeTab === "alerts")/,
  '<PayrollTab teamMembers={teamMembers} />\n        )}\n        {activeTab === "alerts"'
)
fs.writeFileSync("components/admin/AdminDashboard.tsx", c, "utf8")
console.log("Done")
