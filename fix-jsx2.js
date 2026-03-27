const fs = require("fs")
let c = fs.readFileSync("components/admin/AdminDashboard.tsx", "utf8")

// Fix the two orphan divs before Checklist template label
c = c.replace(
  /\s*<div>\s*\r?\n\s*<div>\s*\r?\n\s*<label className="block text-sm font-medium text-gray-600 mb-1">Checklist template<\/label>/,
  '\n                          <div>\n                          <label className="block text-sm font-medium text-gray-600 mb-1">Checklist template</label>'
)

fs.writeFileSync("components/admin/AdminDashboard.tsx", c, "utf8")
console.log("Done")
