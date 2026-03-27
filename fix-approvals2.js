const fs = require("fs")
let c = fs.readFileSync("components/admin/AdminDashboard.tsx", "utf8")
c = c.replace(
  'import PayrollTab from "@/components/admin/PayrollTab"',
  'import PayrollTab from "@/components/admin/PayrollTab"\nimport ApprovalsTab from "@/components/admin/ApprovalsTab"'
)
fs.writeFileSync("components/admin/AdminDashboard.tsx", c, "utf8")
console.log("Done")
