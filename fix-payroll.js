const fs = require("fs")
let c = fs.readFileSync("components/admin/AdminDashboard.tsx", "utf8")
c = c.replace('"use client"', '"use client"\nimport PayrollTab from "@/components/admin/PayrollTab"')
c = c.replace(
  /\{activeTab === "payroll" && \([\s\S]*?\)\s*\}/,
  '{activeTab === "payroll" && (\n          <PayrollTab teamMembers={teamMembers} />\n        )}'
)
fs.writeFileSync("components/admin/AdminDashboard.tsx", c, "utf8")
console.log("Done")
