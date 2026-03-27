const fs = require("fs")
let c = fs.readFileSync("components/admin/AdminDashboard.tsx", "utf8")

// Find and remove the duplicate status section - keep only the first one
const firstStatus = c.indexOf('<label className="block text-sm font-medium text-gray-600 mb-1">Status</label>')
const secondStatus = c.indexOf('<label className="block text-sm font-medium text-gray-600 mb-1">Status</label>', firstStatus + 1)

if (secondStatus > -1) {
  // Find the end of the second status block (up to the next </div>)
  const endOfBlock = c.indexOf('</div>', secondStatus) + 6
  c = c.slice(0, secondStatus) + c.slice(endOfBlock)
  console.log("Removed duplicate status block")
} else {
  console.log("No duplicate found")
}

fs.writeFileSync("components/admin/AdminDashboard.tsx", c, "utf8")
