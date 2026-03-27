const fs = require("fs")
let c = fs.readFileSync("components/admin/AdminDashboard.tsx", "utf8")

// Add import
if (!c.includes("DefectsTab")) {
  c = c.replace(
    'import ApprovalsTab from "@/components/admin/ApprovalsTab"',
    'import ApprovalsTab from "@/components/admin/ApprovalsTab"\nimport DefectsTab from "@/components/admin/DefectsTab"'
  )
}

// Add tab button after Alerts
c = c.replace(
  '          {activeTab === "alerts" ? `Alerts ${unreadAlerts}` : "Alerts"}\n        </button>',
  '          {activeTab === "alerts" ? `Alerts ${unreadAlerts}` : "Alerts"}\n        </button>\n        <button onClick={() => switchTab("defects")} className={tab("defects")}>Defects</button>'
)

// Add tab content
c = c.replace(
  '        {activeTab === "alerts" && (',
  `        {activeTab === "defects" && (
          <DefectsTab />
        )}

        {activeTab === "alerts" && (`
)

fs.writeFileSync("components/admin/AdminDashboard.tsx", c, "utf8")
console.log("Done - " + (c.includes("DefectsTab") ? "SUCCESS" : "FAILED"))
