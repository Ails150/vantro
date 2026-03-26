const fs = require("fs")
let c = fs.readFileSync("components/admin/AdminDashboard.tsx", "utf8")

c = c.replace(
  "{d.ai_processed && <span className=\"text-xs bg-amber-50 text-amber-600 border border-amber-200 px-2 py-1 rounded-full flex-shrink-0 font-medium\">AI alert fired</span>}",
  `{d.ai_alert_type === 'blocker' && <span className="text-xs bg-red-50 text-red-600 border border-red-200 px-2 py-1 rounded-full flex-shrink-0 font-medium">🔴 Blocker</span>}
                  {d.ai_alert_type === 'issue' && <span className="text-xs bg-amber-50 text-amber-600 border border-amber-200 px-2 py-1 rounded-full flex-shrink-0 font-medium">🟡 Issue</span>}
                  {d.ai_summary && <span className="text-xs text-gray-500 italic ml-1">{d.ai_summary}</span>}`
)

fs.writeFileSync("components/admin/AdminDashboard.tsx", c, "utf8")
console.log("Done")
