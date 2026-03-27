const fs = require("fs")
let c = fs.readFileSync("components/admin/AdminDashboard.tsx", "utf8")

// Fix the broken div structure
c = c.replace(
  '                          <div>\n\n                          <div>\n                          <label className="block text-sm font-medium text-gray-600 mb-1">Checklist template</label>',
  '                          <div>\n                          <label className="block text-sm font-medium text-gray-600 mb-1">Checklist template</label>'
)

fs.writeFileSync("components/admin/AdminDashboard.tsx", c, "utf8")
console.log("Done - " + (!c.includes('<div>\n\n                          <div>') ? "SUCCESS" : "FAILED"))
