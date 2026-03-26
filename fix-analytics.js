const fs = require("fs")
let c = fs.readFileSync("components/admin/AdminDashboard.tsx", "utf8")
c = c.replace(
  'import PayrollTab from "@/components/admin/PayrollTab"',
  'import PayrollTab from "@/components/admin/PayrollTab"\nimport AnalyticsTab from "@/components/admin/AnalyticsTab"'
)
c = c.replace(
  '{ id: "overview", label: "Overview" }',
  '{ id: "overview", label: "Overview" },\n    { id: "analytics", label: "Analytics" }'
)
c = c.replace(
  '{activeTab === "approvals"',
  '{activeTab === "analytics" && (\n          <AnalyticsTab companyId={userData.company_id} teamMembers={teamMembers} jobs={jobs} />\n        )}\n        {activeTab === "approvals"'
)
fs.writeFileSync("components/admin/AdminDashboard.tsx", c, "utf8")
console.log("Done")
